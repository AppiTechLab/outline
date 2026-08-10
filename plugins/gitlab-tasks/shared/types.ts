/** A checkbox line in a document that carries a GitLab routing tag. */
export type TaggedTask = {
  /** Document the line belongs to. */
  documentId: string;
  documentTitle: string;
  documentUrl: string;
  /** Zero-based line number within the serialized markdown. */
  lineNumber: number;
  /**
   * The complete original line. Used verbatim as `findText` when patching, so
   * it must not be normalised or trimmed.
   */
  rawLine: string;
  /** Task text with tags and date metadata stripped — becomes the issue title. */
  title: string;
  completed: boolean;
  /** Repository name from #<prefix>/gitlab/<repo>. */
  repo: string;
  /** Usernames from #<prefix>/assign/<user>, in order of appearance. */
  assignees: string[];
  /** ISO date from `📅 YYYY-MM-DD` or `[due:: YYYY-MM-DD]`. */
  dueDate?: string;
  /** Present once the task has been pushed. */
  issue?: { iid: number; url: string; projectPath: string };
};

/** Outcome of pushing or pulling a single task. */
export type SyncResult = {
  documentId: string;
  documentTitle: string;
  title: string;
  status: "created" | "completed" | "skipped" | "failed";
  /** Why it was skipped or how it failed. */
  detail?: string;
  issueUrl?: string;
  issueIid?: number;
};

export type GitLabIssue = {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  state: "opened" | "closed";
  project_id: number;
};

export type GitLabProject = {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  web_url: string;
  archived: boolean;
};

export type GitLabUser = {
  id: number;
  username: string;
  name: string;
};
