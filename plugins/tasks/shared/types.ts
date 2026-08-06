/**
 * Shared types for the tasks plugin. This module is compiled for both the
 * server (via swc into build/plugins) and the client (via Vite), so it must not
 * import anything environment specific.
 */

/**
 * Task priority, ordered so that a numerically higher value is more urgent.
 * This ordering is what `priority above high` style filters compare against.
 */
export enum TaskPriority {
  None = 0,
  Lowest = 1,
  Low = 2,
  Medium = 3,
  High = 4,
  Highest = 5,
}

/** Maps the words accepted in `[priority:: …]` onto the enum. */
export const priorityAliases: Record<string, TaskPriority> = {
  none: TaskPriority.None,
  lowest: TaskPriority.Lowest,
  low: TaskPriority.Low,
  medium: TaskPriority.Medium,
  med: TaskPriority.Medium,
  normal: TaskPriority.Medium,
  high: TaskPriority.High,
  highest: TaskPriority.Highest,
  urgent: TaskPriority.Highest,
};

/** The inverse, for rendering. */
export const priorityLabels: Record<TaskPriority, string> = {
  [TaskPriority.None]: "",
  [TaskPriority.Lowest]: "lowest",
  [TaskPriority.Low]: "low",
  [TaskPriority.Medium]: "medium",
  [TaskPriority.High]: "high",
  [TaskPriority.Highest]: "highest",
};

/** Date fields a task can carry. */
export type TaskDateField =
  | "due"
  | "scheduled"
  | "start"
  | "created"
  | "done"
  | "cancelled";

export const taskDateFields: TaskDateField[] = [
  "due",
  "scheduled",
  "start",
  "created",
  "done",
  "cancelled",
];

/**
 * A single task parsed out of a document's checkbox list.
 */
export type Task = {
  /** Stable identifier, derived from the document and the task's index. */
  id: string;
  /** The document the task lives in. */
  documentId: string;
  documentTitle: string;
  /** Relative URL of the source document, for linking. */
  documentUrl: string;
  /** Title path of the collection, when known. Used by `path includes …`. */
  path: string;
  /** Zero-based index of the task within its document, in reading order. */
  index: number;
  /** Display text, with `[key:: value]` fields removed but tags kept. */
  text: string;
  /** The original text including field annotations. */
  raw: string;
  completed: boolean;
  /** ISO `YYYY-MM-DD` dates, absent when not annotated. */
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  priority: TaskPriority;
  /** Tags without the leading `#`. */
  tags: string[];
  /** Recurrence rule text, captured but not yet acted upon. */
  repeat?: string;
};

/** Comparison operators usable in date and priority filters. */
export type Comparator = "before" | "after" | "on" | "onOrBefore" | "onOrAfter";

export type Filter =
  | { kind: "status"; completed: boolean }
  | {
      kind: "date";
      field: TaskDateField;
      comparator: Comparator;
      /** ISO date, already resolved from keywords like `today`. */
      value: string;
    }
  | { kind: "hasDate"; field: TaskDateField; present: boolean }
  | {
      kind: "priority";
      comparator: "is" | "above" | "below" | "isNot";
      value: TaskPriority;
    }
  | { kind: "tag"; value: string; negated: boolean }
  | { kind: "text"; value: string; negated: boolean }
  | { kind: "path"; value: string; negated: boolean };

export type SortKey =
  | "due"
  | "scheduled"
  | "start"
  | "created"
  | "done"
  | "priority"
  | "text"
  | "path";

export type Sort = {
  key: SortKey;
  reverse: boolean;
};

/**
 * The parsed form of a ```tasks block.
 */
export type TaskQuery = {
  filters: Filter[];
  sort: Sort[];
  limit?: number;
  /** Whether to show the source document name against each result. */
  showPath: boolean;
  /** Lines that could not be understood, surfaced to the user. */
  errors: string[];
};
