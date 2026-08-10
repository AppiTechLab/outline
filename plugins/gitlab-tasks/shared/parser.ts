/**
 * Finds GitLab-tagged tasks in a document's serialized markdown.
 *
 * Routing tags mirror the obsidian-gitlab-tasks plugin; dates are Dataview
 * fields rather than emoji, matching the `tasks` plugin:
 *
 *   - [ ] Fix the login page #PM/gitlab/myrepo #PM/assign/lr [due:: 2026-08-20]
 *   - [ ] Already pushed #PM/gitlab/myrepo #synced [GL-#42](https://gitlab…/42)
 *
 * Everything works on raw markdown lines rather than the ProseMirror tree,
 * because writeback goes through `documentUpdater` in patch mode and its
 * `findText` has to match the serialized markdown exactly.
 */

import type { TaggedTask } from "./types";

/** A markdown checkbox line, bulleted or numbered. */
const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+\.))\s+\[([ xX])\]\s+(.*)$/;

/** The stamp left behind after a successful push. */
export const ISSUE_LINK_RE =
  /\[GL-#(\d+)\]\((https?:\/\/[^)\s]+)\)/;

/** Any hashtag, used to strip routing tags out of the issue title. */
const TAG_RE = /#[\wÀ-￿/-]+/g;

/** Dataview-style inline fields, stripped from titles. */
const FIELD_RE = /\[([a-zA-Z][\w-]*)\s*::\s*([^\]]*)\]/g;

/** `[due:: 2026-08-20]` */
const FIELD_DUE_RE = /\[due\s*::\s*(\d{4}-\d{2}-\d{2})\s*\]/i;

/** Escapes a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** Strips leading `#` and trailing `/` so `#PM/` and `PM` both work. */
export function normalizePrefix(value: string): string {
  return value.replace(/^#+/, "").replace(/\/+$/, "");
}

/**
 * Extracts the repository name from `#<prefix>/gitlab/<repo>`.
 */
export function extractRepo(
  text: string,
  tagPrefix: string
): string | undefined {
  const prefix = escapeRegExp(normalizePrefix(tagPrefix));
  const match = new RegExp(`#${prefix}/gitlab/([^\\s#]+)`, "i").exec(text);
  return match?.[1];
}

/**
 * Extracts every `#<prefix>/assign/<username>`, preserving order and
 * discarding duplicates.
 */
export function extractAssignees(text: string, tagPrefix: string): string[] {
  const prefix = escapeRegExp(normalizePrefix(tagPrefix));
  const regex = new RegExp(`#${prefix}/assign/([^\\s#]+)`, "gi");
  const assignees: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const username = match[1];
    if (!assignees.some((a) => a.toLowerCase() === username.toLowerCase())) {
      assignees.push(username);
    }
  }

  return assignees;
}

/**
 * Reads the due date from `[due:: YYYY-MM-DD]`.
 *
 * The Obsidian emoji form is deliberately not accepted, so there is one way to
 * write a date and it matches the `tasks` plugin.
 */
export function extractDueDate(text: string): string | undefined {
  return FIELD_DUE_RE.exec(text)?.[1];
}

/**
 * Reads the `[GL-#42](url)` stamp and derives the project path from the URL.
 *
 * @param text The task text.
 * @param gitlabUrl Base URL of the instance, used to strip the origin.
 */
export function extractIssueLink(text: string, gitlabUrl: string) {
  const match = ISSUE_LINK_RE.exec(text);
  if (!match) {
    return undefined;
  }

  const [, iid, url] = match;
  const base = gitlabUrl.replace(/\/+$/, "");
  const path = url.startsWith(base) ? url.slice(base.length + 1) : url;
  // GitLab issue URLs look like <group>/<project>/-/issues/<iid>, and newer
  // instances may say `work_items` instead.
  const projectPath =
    /^(.+)\/-\/(?:issues|work_items)\/\d+$/.exec(path)?.[1] ?? "";

  return { iid: parseInt(iid, 10), url, projectPath };
}

/**
 * Reduces a task line to a clean issue title by removing tags, inline fields
 * and the issue link.
 *
 * Obsidian's emoji metadata is not handled, deliberately. Since `📅` no longer
 * sets a due date, leaving it visible in the issue title is what tells you the
 * date didn't take.
 */
export function toIssueTitle(text: string): string {
  return text
    .replace(ISSUE_LINK_RE, "")
    .replace(FIELD_RE, "")
    .replace(TAG_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type ParseContext = {
  documentId: string;
  documentTitle: string;
  documentUrl: string;
};

type ParseOptions = {
  tagPrefix: string;
  syncedTag: string;
  gitlabUrl: string;
};

/**
 * Scans a document's markdown for tasks carrying a GitLab routing tag.
 *
 * Returns every tagged task regardless of sync state; callers filter by
 * `issue` presence and `completed` depending on the direction they're syncing.
 *
 * @param markdown The serialized document, without the title.
 * @param context Identifying information about the document.
 * @param options Tag vocabulary and instance URL.
 */
export function findTaggedTasks(
  markdown: string,
  context: ParseContext,
  options: ParseOptions
): TaggedTask[] {
  const tasks: TaggedTask[] = [];
  const lines = markdown.split("\n");

  lines.forEach((rawLine, lineNumber) => {
    const match = TASK_LINE_RE.exec(rawLine);
    if (!match) {
      return;
    }

    const [, , marker, text] = match;
    const repo = extractRepo(text, options.tagPrefix);
    if (!repo) {
      return;
    }

    tasks.push({
      ...context,
      lineNumber,
      rawLine,
      title: toIssueTitle(text),
      completed: marker.toLowerCase() === "x",
      repo,
      assignees: extractAssignees(text, options.tagPrefix),
      dueDate: extractDueDate(text),
      issue: extractIssueLink(text, options.gitlabUrl),
    });
  });

  return tasks;
}

/**
 * Produces the replacement line stamping a task as pushed.
 *
 * Appending rather than rewriting keeps the user's own formatting intact, and
 * keeps the change small enough that a concurrent editor is unlikely to
 * conflict with it.
 */
export function stampSynced(
  rawLine: string,
  syncedTag: string,
  issueIid: number,
  issueUrl: string
): string {
  return `${rawLine.trimEnd()} ${syncedTag} [GL-#${issueIid}](${issueUrl})`;
}

/**
 * Produces the replacement line ticking a task's checkbox.
 *
 * Only the first `[ ]` is touched, which is the task's own marker — any later
 * bracket pair belongs to the text or the issue link.
 */
export function stampCompleted(rawLine: string): string {
  return rawLine.replace(/\[ \]/, "[x]");
}
