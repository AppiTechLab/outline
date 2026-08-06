import Router from "koa-router";
import { Op, Sequelize } from "sequelize";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { Collection, Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import Logger from "@server/logging/Logger";
import type { APIContext } from "@server/types";
import { parseTask, parseTasksFromMarkdown } from "../../shared/parser";
import { applyQuery, parseQuery } from "../../shared/query";
import type { Task } from "../../shared/types";
import * as T from "./schema";

const router = new Router();

/**
 * Upper bound on how many documents a single query will open. Tasks are parsed
 * at request time rather than from an index, so this is what stops a large
 * workspace from turning one code block into a multi-second query.
 */
const MaxDocumentsScanned = 1500;

/**
 * Walks a Prosemirror document collecting every checkbox list item.
 *
 * Nested checkbox lists are visited in reading order, which is what makes the
 * item index usable as a stable-enough identifier between renders.
 *
 * @param doc The Prosemirror document.
 * @param context Identifying information about the source document.
 * @returns the parsed tasks.
 */
function extractTasks(
  doc: ProsemirrorNode,
  context: {
    documentId: string;
    documentTitle: string;
    documentUrl: string;
    path: string;
  }
): Task[] {
  const tasks: Task[] = [];

  doc.descendants((node) => {
    if (node.type.name !== "checkbox_item") {
      // Keep descending; checkbox items can be nested inside other lists.
      return true;
    }

    tasks.push(
      parseTask(node.textContent.trim(), Boolean(node.attrs.checked), {
        ...context,
        index: tasks.length,
      })
    );

    // Descend anyway so nested sub-tasks are collected too.
    return true;
  });

  return tasks;
}

router.post(
  "tasks.list",
  auth(),
  validate(T.TasksListSchema),
  async (ctx: APIContext<T.TasksListReq>) => {
    const { query: source, collectionId } = ctx.input.body;
    const { user } = ctx.state.auth;

    const query = parseQuery(source);

    // Collections the user can actually read. Passing this to the where clause
    // is what keeps the scan inside the user's permissions — there is no
    // per-document authorize() call on this path because we never return
    // document bodies, only task lines.
    const readableCollectionIds = await user.collectionIds();
    const collectionIds = collectionId
      ? readableCollectionIds.filter((id) => id === collectionId)
      : readableCollectionIds;

    if (!collectionIds.length) {
      ctx.body = {
        data: { tasks: [], total: 0, scanned: 0, errors: query.errors },
      };
      return;
    }

    const documents = await Document.findAll({
      attributes: ["id", "urlId", "title", "content", "text", "collectionId"],
      where: {
        teamId: user.teamId,
        collectionId: { [Op.in]: collectionIds },
        deletedAt: { [Op.eq]: null },
        archivedAt: { [Op.eq]: null },
        template: false,
        // Cheap prefilter so documents with no checkboxes are never
        // deserialized. Covers both the Prosemirror snapshot and the legacy
        // markdown column.
        [Op.or]: [
          Sequelize.literal(`"document"."content"::text LIKE '%checkbox_item%'`),
          Sequelize.literal(`"document"."text" LIKE '%- [%'`),
        ],
      },
      order: [["updatedAt", "DESC"]],
      limit: MaxDocumentsScanned,
    });

    const collections = await Collection.findAll({
      attributes: ["id", "name"],
      where: { id: { [Op.in]: collectionIds } },
    });
    const collectionNames = new Map(collections.map((c) => [c.id, c.name]));

    const tasks: Task[] = [];

    for (const document of documents) {
      const context = {
        documentId: document.id,
        documentTitle: document.title || "Untitled",
        documentUrl: document.path,
        path: collectionNames.get(document.collectionId ?? "") ?? "",
      };

      try {
        const node = DocumentHelper.toProsemirror(document);
        tasks.push(...extractTasks(node, context));
      } catch (err) {
        // A single unparseable document shouldn't blank out the whole query.
        Logger.warn("Failed to parse document while listing tasks", {
          documentId: document.id,
          error: err instanceof Error ? err.message : String(err),
        });

        if (document.text) {
          tasks.push(...parseTasksFromMarkdown(document.text, context));
        }
      }
    }

    const result = applyQuery(tasks, query);

    ctx.body = {
      data: {
        tasks: result.tasks,
        total: result.total,
        scanned: documents.length,
        truncated: documents.length >= MaxDocumentsScanned,
        errors: query.errors,
      },
    };
  }
);

export default router;
