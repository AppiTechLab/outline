/**
 * Parses and evaluates the little query language used inside ```tasks blocks.
 *
 * One instruction per line, blank lines and `#` comments ignored:
 *
 *   not done
 *   due before today
 *   priority above medium
 *   tag includes work
 *   sort by due
 *   limit 20
 *
 * Unrecognised lines are collected into `errors` rather than throwing, so a
 * typo degrades to a visible warning instead of an empty result.
 */

import { resolveDate } from "./parser";
import type {
  Comparator,
  Filter,
  Sort,
  SortKey,
  Task,
  TaskDateField,
  TaskQuery,
} from "./types";
import { priorityAliases } from "./types";

const sortKeys: SortKey[] = [
  "due",
  "scheduled",
  "start",
  "created",
  "done",
  "priority",
  "text",
  "path",
];

/** `due before 2026-08-10`, `scheduled on or after today` */
const DATE_FILTER_RE =
  /^(due|scheduled|start|created|done|cancelled)\s+(before|after|on or before|on or after|on)\s+(.+)$/;

/** `no due date` / `has due date` */
const HAS_DATE_RE =
  /^(no|has)\s+(due|scheduled|start|created|done|cancelled)\s+date$/;

/** `priority is high`, `priority above medium`, `priority is not none` */
const PRIORITY_RE = /^priority\s+(is not|is|above|below)\s+(.+)$/;

/** `tag includes work`, `tag does not include work` */
const TAG_RE = /^tags?\s+(includes|does not include)\s+(.+)$/;

/** `text includes review`, `description does not include draft` */
const TEXT_RE =
  /^(?:text|description)\s+(includes|does not include)\s+(.+)$/;

/** `path includes Projects` */
const PATH_RE = /^path\s+(includes|does not include)\s+(.+)$/;

/** `sort by due`, `sort by priority reverse` */
const SORT_RE = /^sort\s+by\s+(\w+)(\s+reverse)?$/;

/** `limit 20`, `limit to 20` */
const LIMIT_RE = /^limit(?:\s+to)?\s+(\d+)$/;

const comparators: Record<string, Comparator> = {
  before: "before",
  after: "after",
  on: "on",
  "on or before": "onOrBefore",
  "on or after": "onOrAfter",
};

/**
 * Parses the body of a ```tasks block.
 *
 * @param source The raw text inside the code fence.
 * @param now Injectable clock, so `today` is testable.
 * @returns the parsed query, including any per-line errors.
 */
export function parseQuery(source: string, now: Date = new Date()): TaskQuery {
  const query: TaskQuery = {
    filters: [],
    sort: [],
    showPath: true,
    errors: [],
  };

  const lines = source.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.toLowerCase();

    if (normalized === "done") {
      query.filters.push({ kind: "status", completed: true });
      continue;
    }

    if (normalized === "not done" || normalized === "open") {
      query.filters.push({ kind: "status", completed: false });
      continue;
    }

    if (normalized === "hide path" || normalized === "hide document") {
      query.showPath = false;
      continue;
    }

    if (normalized === "show path" || normalized === "show document") {
      query.showPath = true;
      continue;
    }

    const dateMatch = DATE_FILTER_RE.exec(normalized);
    if (dateMatch) {
      const [, field, comparator, value] = dateMatch;
      const resolved = resolveDate(value, now);
      if (!resolved) {
        query.errors.push(
          `Could not understand the date "${value.trim()}" — use YYYY-MM-DD, today, tomorrow or yesterday.`
        );
        continue;
      }
      query.filters.push({
        kind: "date",
        field: field as TaskDateField,
        comparator: comparators[comparator],
        value: resolved,
      });
      continue;
    }

    const hasDateMatch = HAS_DATE_RE.exec(normalized);
    if (hasDateMatch) {
      const [, presence, field] = hasDateMatch;
      query.filters.push({
        kind: "hasDate",
        field: field as TaskDateField,
        present: presence === "has",
      });
      continue;
    }

    const priorityMatch = PRIORITY_RE.exec(normalized);
    if (priorityMatch) {
      const [, operator, word] = priorityMatch;
      const value = priorityAliases[word.trim()];
      if (value === undefined) {
        query.errors.push(
          `Unknown priority "${word.trim()}" — use none, lowest, low, medium, high or highest.`
        );
        continue;
      }
      query.filters.push({
        kind: "priority",
        comparator:
          operator === "is not"
            ? "isNot"
            : (operator as "is" | "above" | "below"),
        value,
      });
      continue;
    }

    // Tag, text and path operands are matched case-insensitively, so the
    // already-lowercased form is what gets stored.
    const tagMatch = TAG_RE.exec(normalized);
    if (tagMatch) {
      query.filters.push({
        kind: "tag",
        value: tagMatch[2].trim().replace(/^#/, ""),
        negated: tagMatch[1] === "does not include",
      });
      continue;
    }

    const textMatch = TEXT_RE.exec(normalized);
    if (textMatch) {
      query.filters.push({
        kind: "text",
        value: textMatch[2].trim(),
        negated: textMatch[1] === "does not include",
      });
      continue;
    }

    const pathMatch = PATH_RE.exec(normalized);
    if (pathMatch) {
      query.filters.push({
        kind: "path",
        value: pathMatch[2].trim(),
        negated: pathMatch[1] === "does not include",
      });
      continue;
    }

    const sortMatch = SORT_RE.exec(normalized);
    if (sortMatch) {
      const [, key, reverse] = sortMatch;
      if (!sortKeys.includes(key as SortKey)) {
        query.errors.push(
          `Cannot sort by "${key}" — try ${sortKeys.join(", ")}.`
        );
        continue;
      }
      query.sort.push({ key: key as SortKey, reverse: Boolean(reverse) });
      continue;
    }

    const limitMatch = LIMIT_RE.exec(normalized);
    if (limitMatch) {
      query.limit = Number(limitMatch[1]);
      continue;
    }

    query.errors.push(`Could not understand "${line}".`);
  }

  return query;
}

/**
 * Compares two ISO date strings. Because they're zero-padded and fixed width,
 * lexicographic order matches chronological order.
 */
function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Evaluates a single filter against a task. */
function matches(task: Task, filter: Filter): boolean {
  switch (filter.kind) {
    case "status":
      return task.completed === filter.completed;

    case "date": {
      const value = task[filter.field];
      // A task with no date can't satisfy a date comparison.
      if (!value) {
        return false;
      }
      const comparison = compareDates(value, filter.value);
      switch (filter.comparator) {
        case "before":
          return comparison < 0;
        case "after":
          return comparison > 0;
        case "on":
          return comparison === 0;
        case "onOrBefore":
          return comparison <= 0;
        case "onOrAfter":
          return comparison >= 0;
        default:
          return false;
      }
    }

    case "hasDate":
      return Boolean(task[filter.field]) === filter.present;

    case "priority":
      switch (filter.comparator) {
        case "is":
          return task.priority === filter.value;
        case "isNot":
          return task.priority !== filter.value;
        case "above":
          return task.priority > filter.value;
        case "below":
          return task.priority < filter.value;
        default:
          return false;
      }

    case "tag": {
      const present = task.tags.includes(filter.value);
      return filter.negated ? !present : present;
    }

    case "text": {
      const present = task.text.toLowerCase().includes(filter.value);
      return filter.negated ? !present : present;
    }

    case "path": {
      const haystack = `${task.path} ${task.documentTitle}`.toLowerCase();
      const present = haystack.includes(filter.value);
      return filter.negated ? !present : present;
    }

    default:
      return true;
  }
}

/**
 * Orders two tasks by a single sort key. Tasks missing the sorted field sort
 * last regardless of direction — an undated task is not "earliest".
 */
function compareBy(a: Task, b: Task, sort: Sort): number {
  let result = 0;

  if (sort.key === "priority") {
    // Higher priority first, so this comparison is inverted.
    result = b.priority - a.priority;
  } else if (sort.key === "text") {
    result = a.text.localeCompare(b.text);
  } else if (sort.key === "path") {
    result = `${a.path} ${a.documentTitle}`.localeCompare(
      `${b.path} ${b.documentTitle}`
    );
  } else {
    const left = a[sort.key as TaskDateField];
    const right = b[sort.key as TaskDateField];

    if (!left && !right) {
      result = 0;
    } else if (!left) {
      return 1;
    } else if (!right) {
      return -1;
    } else {
      result = compareDates(left, right);
    }
  }

  return sort.reverse ? -result : result;
}

/**
 * Applies a parsed query to a list of tasks.
 *
 * @param tasks Every task visible to the user.
 * @param query The parsed ```tasks block.
 * @returns the filtered, sorted and truncated tasks, plus the pre-limit total.
 */
export function applyQuery(
  tasks: Task[],
  query: TaskQuery
): { tasks: Task[]; total: number } {
  const filtered = tasks.filter((task) =>
    query.filters.every((filter) => matches(task, filter))
  );

  if (query.sort.length) {
    filtered.sort((a, b) => {
      for (const sort of query.sort) {
        const result = compareBy(a, b, sort);
        if (result !== 0) {
          return result;
        }
      }
      return 0;
    });
  }

  const total = filtered.length;

  return {
    tasks: query.limit ? filtered.slice(0, query.limit) : filtered,
    total,
  };
}

/**
 * True when the query asks a question that only concerns open tasks. Used to
 * skip parsing completed items on the server for a small speedup.
 */
export function isOpenOnly(query: TaskQuery): boolean {
  return query.filters.some(
    (filter) => filter.kind === "status" && !filter.completed
  );
}
