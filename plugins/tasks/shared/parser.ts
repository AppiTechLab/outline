/**
 * Parses Dataview-style inline fields out of task text.
 *
 * A task is any checkbox list item. Metadata is written as `[key:: value]`
 * anywhere in the line, and tags as `#tag`:
 *
 *   - [ ] Draft the proposal [due:: 2026-08-12] [priority:: high] #work
 *   - [x] Send invoices [due:: 2026-08-01] [done:: 2026-08-01]
 */

import type { Task, TaskDateField } from "./types";
import { TaskPriority, priorityAliases, taskDateFields } from "./types";

/** Matches `[key:: value]`. The value may not contain a closing bracket. */
const FIELD_RE = /\[([a-zA-Z][\w-]*)\s*::\s*([^\]]*)\]/g;

/** Matches `#tag`, allowing nesting with `/` and hyphens. */
const TAG_RE = /(^|\s)#([\wÀ-￿/-]+)/g;

/** Strict `YYYY-MM-DD`. Anything else is left unparsed. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Returns today's date as `YYYY-MM-DD` in local time.
 *
 * Deliberately local rather than UTC: a task due "today" should flip over at
 * the reader's midnight, not at UTC midnight.
 */
export function today(now: Date = new Date()): string {
  return toISODate(now);
}

/** Formats a Date as a local `YYYY-MM-DD` string. */
export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Adds a number of days to an ISO date string, returning a new ISO date.
 */
export function addDays(iso: string, days: number): string {
  const parsed = parseISODate(iso);
  if (!parsed) {
    return iso;
  }
  parsed.setDate(parsed.getDate() + days);
  return toISODate(parsed);
}

/**
 * Parses `YYYY-MM-DD` into a local-midnight Date, or undefined if malformed.
 * Rejects impossible dates such as `2026-02-31`, which the Date constructor
 * would otherwise silently roll forward.
 */
export function parseISODate(value: string): Date | undefined {
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return undefined;
  }
  return date;
}

/**
 * Resolves a date expression to an ISO date. Accepts `YYYY-MM-DD` plus the
 * relative keywords `today`, `tomorrow` and `yesterday`.
 *
 * @returns the ISO date, or undefined when the input isn't a date.
 */
export function resolveDate(value: string, now: Date = new Date()) {
  const trimmed = value.trim().toLowerCase();

  switch (trimmed) {
    case "today":
      return today(now);
    case "tomorrow":
      return addDays(today(now), 1);
    case "yesterday":
      return addDays(today(now), -1);
    default:
      return parseISODate(trimmed) ? trimmed : undefined;
  }
}

/** The result of stripping metadata out of a line of task text. */
type ExtractedFields = {
  fields: Record<string, string>;
  tags: string[];
  /** The text with `[key:: value]` annotations removed. */
  text: string;
};

/**
 * Pulls `[key:: value]` fields and `#tags` out of a string.
 *
 * Tags are left in the display text because they read naturally inline, but
 * field annotations are stripped since they're rendered as separate chips.
 */
export function extractFields(input: string): ExtractedFields {
  const fields: Record<string, string> = {};

  const text = input
    .replace(FIELD_RE, (_match, key: string, value: string) => {
      fields[key.toLowerCase()] = value.trim();
      return "";
    })
    // Collapse the whitespace left behind by removed annotations.
    .replace(/\s{2,}/g, " ")
    .trim();

  const tags: string[] = [];
  let tagMatch: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((tagMatch = TAG_RE.exec(input)) !== null) {
    const tag = tagMatch[2].toLowerCase();
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return { fields, tags, text };
}

/**
 * Builds a Task from a checkbox item's text content.
 *
 * @param input The raw text of the checkbox item.
 * @param completed Whether the checkbox is ticked.
 * @param context Identifying information about the source document.
 * @returns a fully parsed Task.
 */
export function parseTask(
  input: string,
  completed: boolean,
  context: {
    documentId: string;
    documentTitle: string;
    documentUrl: string;
    path: string;
    index: number;
  }
): Task {
  const { fields, tags, text } = extractFields(input);

  const task: Task = {
    id: `${context.documentId}:${context.index}`,
    documentId: context.documentId,
    documentTitle: context.documentTitle,
    documentUrl: context.documentUrl,
    path: context.path,
    index: context.index,
    text,
    raw: input,
    completed,
    priority: TaskPriority.None,
    tags,
  };

  for (const field of taskDateFields) {
    const value = fields[field];
    if (value) {
      const resolved = resolveDate(value);
      if (resolved) {
        task[field as TaskDateField] = resolved;
      }
    }
  }

  const priority = fields.priority?.toLowerCase();
  if (priority && priority in priorityAliases) {
    task.priority = priorityAliases[priority];
  }

  const repeat = fields.repeat ?? fields.recur ?? fields.every;
  if (repeat) {
    task.repeat = repeat;
  }

  return task;
}

/**
 * Extracts tasks from raw markdown, used as a fallback for documents that have
 * no ProseMirror content snapshot stored.
 *
 * @param markdown The document body.
 * @param context Identifying information about the source document.
 * @returns the parsed tasks, in document order.
 */
export function parseTasksFromMarkdown(
  markdown: string,
  context: {
    documentId: string;
    documentTitle: string;
    documentUrl: string;
    path: string;
  }
): Task[] {
  const CHECKBOX_LINE_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
  const tasks: Task[] = [];

  markdown.split("\n").forEach((line) => {
    const match = CHECKBOX_LINE_RE.exec(line);
    if (!match) {
      return;
    }
    const [, marker, rest] = match;
    tasks.push(
      parseTask(rest, marker.toLowerCase() === "x", {
        ...context,
        index: tasks.length,
      })
    );
  });

  return tasks;
}
