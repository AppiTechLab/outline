import Router from "koa-router";
import { Op, Sequelize } from "sequelize";
import { TextEditMode } from "@shared/types";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import documentUpdater from "@server/commands/documentUpdater";
import { InvalidRequestError } from "@server/errors";
import Logger from "@server/logging/Logger";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";
import env from "@server/env";
import {
  findTaggedTasks,
  stampCompleted,
  stampSynced,
} from "../../shared/parser";
import type { SyncResult, TaggedTask } from "../../shared/types";
import pluginEnv from "../env";
import * as GitLab from "../gitlab";
import * as T from "./schema";

const router = new Router();

/** Ceiling on documents opened by a workspace-wide sync. */
const MaxDocumentsScanned = 1500;

/**
 * The tag prefix is operator-supplied but still ends up inside a raw SQL
 * literal, so it is restricted to characters that cannot terminate a string or
 * introduce a wildcard.
 */
function safeTagPrefix(): string {
  const prefix = pluginEnv.GITLAB_TASKS_TAG_PREFIX;
  if (!/^[\w/-]+$/.test(prefix)) {
    throw InvalidRequestError(
      "GITLAB_TASKS_TAG_PREFIX may only contain letters, digits, underscores, hyphens and slashes."
    );
  }
  return prefix;
}

/**
 * Loads the documents in scope and extracts every GitLab-tagged task.
 *
 * Documents are returned alongside their tasks because writeback needs the
 * model instance, and reloading it per task would multiply queries.
 */
async function collectTasks(
  ctx: APIContext,
  documentId?: string
): Promise<{ document: Document; tasks: TaggedTask[] }[]> {
  const { user } = ctx.state.auth;
  const { transaction: tx } = ctx.state;

  const options = {
    tagPrefix: pluginEnv.GITLAB_TASKS_TAG_PREFIX,
    syncedTag: pluginEnv.GITLAB_TASKS_SYNCED_TAG,
    gitlabUrl: pluginEnv.GITLAB_TASKS_URL ?? "",
  };

  let documents: Document[];

  if (documentId) {
    const document = await Document.findByPk(documentId, {
      userId: user.id,
      includeState: true,
      transaction: tx,
    });
    // Throws NotFound for a missing document and Authorization for one the
    // user may read but not edit — syncing rewrites task lines.
    authorize(user, "update", document);
    documents = document ? [document] : [];
  } else {
    const collectionIds = await user.collectionIds();
    if (!collectionIds.length) {
      return [];
    }

    const tagPrefix = safeTagPrefix();

    // `withState` is essential, not an optimisation. applyMarkdownToDocument
    // only rewrites the Yjs state when document.state is loaded; without it the
    // markdown would be patched while the collaborative state stayed stale, and
    // the next editing session would silently revert the change.
    documents = await Document.scope("withState").findAll({
      where: {
        teamId: user.teamId,
        collectionId: { [Op.in]: collectionIds },
        deletedAt: { [Op.eq]: null },
        archivedAt: { [Op.eq]: null },
        template: false,
        // Cheap prefilter: only documents mentioning the routing tag can
        // possibly contain a task we care about.
        [Op.or]: [
          Sequelize.literal(
            `"document"."content"::text ILIKE '%${tagPrefix}/gitlab/%'`
          ),
          Sequelize.literal(
            `"document"."text" ILIKE '%${tagPrefix}/gitlab/%'`
          ),
        ],
      },
      order: [["updatedAt", "DESC"]],
      limit: MaxDocumentsScanned,
      transaction: tx,
    });
  }

  const results: { document: Document; tasks: TaggedTask[] }[] = [];

  for (const document of documents) {
    // Serialized without the title so offsets line up with what
    // applyMarkdownToDocument sees when it resolves findText.
    const markdown = await DocumentHelper.toMarkdown(document, {
      includeTitle: false,
    });

    const tasks = findTaggedTasks(
      markdown,
      {
        documentId: document.id,
        documentTitle: document.title || "Untitled",
        documentUrl: document.path,
      },
      options
    );

    if (tasks.length) {
      results.push({ document, tasks });
    }
  }

  return results;
}

/**
 * Rewrites a single task line in place.
 *
 * Patch mode resolves `findText` with `markdown.indexOf`, so two byte-identical
 * task lines in one document would both resolve to the first occurrence. Tasks
 * carrying an issue link are naturally unique; unsynced duplicates are the
 * documented caveat.
 */
async function patchLine(
  ctx: APIContext,
  document: Document,
  findText: string,
  replacement: string
) {
  await documentUpdater(ctx, {
    document,
    text: replacement,
    editMode: TextEditMode.Patch,
    findText,
  });
}

function assertConfigured() {
  if (!GitLab.isConfigured()) {
    throw InvalidRequestError(
      "GitLab sync is not configured — set GITLAB_TASKS_URL and GITLAB_TASKS_TOKEN."
    );
  }
}

/**
 * Reports configuration state and verifies the token, so problems surface
 * before anyone runs a sync that half-succeeds.
 */
router.post(
  "gitlabTasks.status",
  auth(),
  validate(T.GitLabTasksStatusSchema),
  async (ctx: APIContext<T.GitLabTasksStatusReq>) => {
    const configured = GitLab.isConfigured();

    let account: string | undefined;
    let error: string | undefined;

    if (configured) {
      try {
        account = (await GitLab.getCurrentUser()).username;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }

    ctx.body = {
      data: {
        configured,
        url: pluginEnv.GITLAB_TASKS_URL,
        tagPrefix: pluginEnv.GITLAB_TASKS_TAG_PREFIX,
        syncedTag: pluginEnv.GITLAB_TASKS_SYNCED_TAG,
        fallbackProject: pluginEnv.GITLAB_TASKS_FALLBACK_PROJECT,
        account,
        error,
      },
    };
  }
);

/**
 * Creates GitLab issues for tagged tasks that don't have one yet, then stamps
 * each task with its issue link.
 */
router.post(
  "gitlabTasks.push",
  auth(),
  validate(T.GitLabTasksPushSchema),
  transaction(),
  async (ctx: APIContext<T.GitLabTasksPushReq>) => {
    assertConfigured();

    const { documentId, dryRun } = ctx.input.body;
    const collected = await collectTasks(ctx, documentId);
    const results: SyncResult[] = [];

    // Cache project lookups: a sweep usually routes many tasks to a handful of
    // repositories, and each miss is an API round-trip.
    const projectPaths = new Map<string, string | undefined>();

    for (const { document, tasks } of collected) {
      for (const task of tasks) {
        const base = {
          documentId: task.documentId,
          documentTitle: task.documentTitle,
          title: task.title,
        };

        if (task.issue) {
          results.push({
            ...base,
            status: "skipped",
            detail: "Already synced",
            issueIid: task.issue.iid,
            issueUrl: task.issue.url,
          });
          continue;
        }

        if (task.completed) {
          results.push({
            ...base,
            status: "skipped",
            detail: "Task is already complete",
          });
          continue;
        }

        if (!task.title) {
          results.push({
            ...base,
            status: "skipped",
            detail: "Task has no text once tags are removed",
          });
          continue;
        }

        try {
          if (!projectPaths.has(task.repo)) {
            projectPaths.set(
              task.repo,
              await GitLab.resolveProjectPath(task.repo)
            );
          }
          const projectPath = projectPaths.get(task.repo);

          if (!projectPath) {
            results.push({
              ...base,
              status: "skipped",
              detail: `No GitLab project matches "${task.repo}" and no fallback is configured`,
            });
            continue;
          }

          if (dryRun) {
            results.push({
              ...base,
              status: "created",
              detail: `Would create in ${projectPath}`,
            });
            continue;
          }

          const assigneeIds = await GitLab.resolveAssigneeIds(task.assignees);

          const issue = await GitLab.createIssue(projectPath, {
            title: task.title,
            description: [
              task.title,
              "",
              `Synced from Outline: ${env.URL}${task.documentUrl}`,
            ].join("\n"),
            dueDate: task.dueDate,
            assigneeIds,
          });

          await patchLine(
            ctx,
            document,
            task.rawLine,
            stampSynced(
              task.rawLine,
              pluginEnv.GITLAB_TASKS_SYNCED_TAG,
              issue.iid,
              issue.web_url
            )
          );

          results.push({
            ...base,
            status: "created",
            issueIid: issue.iid,
            issueUrl: issue.web_url,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          Logger.warn("GitLab task push failed", {
            documentId: task.documentId,
            error: detail,
          });
          results.push({ ...base, status: "failed", detail });
        }
      }
    }

    ctx.body = { data: { dryRun, results } };
  }
);

/**
 * Ticks tasks whose linked GitLab issue has since been closed.
 */
router.post(
  "gitlabTasks.pull",
  auth(),
  validate(T.GitLabTasksPullSchema),
  transaction(),
  async (ctx: APIContext<T.GitLabTasksPullReq>) => {
    assertConfigured();

    const { documentId, dryRun } = ctx.input.body;
    const collected = await collectTasks(ctx, documentId);
    const results: SyncResult[] = [];

    // Open tasks that have been pushed, grouped by project so each project
    // costs one request rather than one per issue.
    const pending = collected.flatMap(({ document, tasks }) =>
      tasks
        .filter((task) => task.issue && !task.completed)
        .map((task) => ({ document, task }))
    );

    const byProject = new Map<string, typeof pending>();
    for (const entry of pending) {
      const path = entry.task.issue!.projectPath;
      if (!path) {
        results.push({
          documentId: entry.task.documentId,
          documentTitle: entry.task.documentTitle,
          title: entry.task.title,
          status: "skipped",
          detail: "Could not read a project path from the issue link",
        });
        continue;
      }
      byProject.set(path, [...(byProject.get(path) ?? []), entry]);
    }

    for (const [projectPath, entries] of byProject) {
      try {
        const issues = await GitLab.getIssuesByIid(
          projectPath,
          entries.map((entry) => entry.task.issue!.iid)
        );
        const states = new Map(issues.map((issue) => [issue.iid, issue.state]));

        for (const { document, task } of entries) {
          const base = {
            documentId: task.documentId,
            documentTitle: task.documentTitle,
            title: task.title,
            issueIid: task.issue!.iid,
            issueUrl: task.issue!.url,
          };

          const state = states.get(task.issue!.iid);

          if (state !== "closed") {
            results.push({
              ...base,
              status: "skipped",
              detail: state ? "Issue is still open" : "Issue not found",
            });
            continue;
          }

          if (dryRun) {
            results.push({
              ...base,
              status: "completed",
              detail: "Would tick this task",
            });
            continue;
          }

          await patchLine(
            ctx,
            document,
            task.rawLine,
            stampCompleted(task.rawLine)
          );

          results.push({ ...base, status: "completed" });
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        Logger.warn("GitLab task pull failed", { projectPath, error: detail });

        for (const { task } of entries) {
          results.push({
            documentId: task.documentId,
            documentTitle: task.documentTitle,
            title: task.title,
            status: "failed",
            detail,
          });
        }
      }
    }

    ctx.body = { data: { dryRun, results } };
  }
);

export default router;
