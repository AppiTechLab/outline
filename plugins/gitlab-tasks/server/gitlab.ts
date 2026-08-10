/**
 * Minimal GitLab REST v4 client, covering only what issue sync needs.
 *
 * Uses Outline's fetch wrapper rather than node-fetch directly so outgoing
 * requests inherit the SSRF filtering and proxy handling the rest of the server
 * uses. Self-hosted instances on a private network need
 * GITLAB_TASKS_ALLOW_PRIVATE_IP=true to be reachable at all.
 */

import fetch from "@server/utils/fetch";
import { InvalidRequestError } from "@server/errors";
import Logger from "@server/logging/Logger";
import type {
  GitLabIssue,
  GitLabProject,
  GitLabUser,
} from "../shared/types";
import env from "./env";

const RequestTimeoutMs = 15000;

/** True when the plugin has enough configuration to talk to GitLab. */
export function isConfigured(): boolean {
  return Boolean(env.GITLAB_TASKS_URL && env.GITLAB_TASKS_TOKEN);
}

function baseUrl(): string {
  return (env.GITLAB_TASKS_URL ?? "").replace(/\/+$/, "");
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const url = `${baseUrl()}/api/v4${path}`;

  const response = await fetch(url, {
    method: init.method ?? "GET",
    timeout: RequestTimeoutMs,
    allowPrivateIPAddress: env.GITLAB_TASKS_ALLOW_PRIVATE_IP,
    headers: {
      "PRIVATE-TOKEN": env.GITLAB_TASKS_TOKEN ?? "",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // The token is in a header, not the URL, so the path is safe to log.
    Logger.warn("GitLab API request failed", {
      path,
      status: response.status,
    });
    throw InvalidRequestError(
      `GitLab responded ${response.status} for ${path}${
        detail ? `: ${detail.slice(0, 200)}` : ""
      }`
    );
  }

  return (await response.json()) as T;
}

/**
 * Verifies the token and returns the account it belongs to. Used by the
 * `.status` endpoint so misconfiguration surfaces before a sync is attempted.
 */
export function getCurrentUser(): Promise<GitLabUser> {
  return request<GitLabUser>("/user");
}

/**
 * Finds a project by repository name.
 *
 * `search` matches loosely, so results are narrowed to an exact match on the
 * final path segment; a fuzzy match would happily route a task to the wrong
 * project. Falls back to GITLAB_TASKS_FALLBACK_PROJECT when nothing matches.
 *
 * @param repo Repository name from the task's routing tag.
 * @returns the project path to create the issue in, or undefined.
 */
export async function resolveProjectPath(
  repo: string
): Promise<string | undefined> {
  const projects = await request<GitLabProject[]>(
    `/projects?membership=true&archived=false&per_page=100&search=${encodeURIComponent(
      repo
    )}`
  );

  const exact = projects.find(
    (project) => project.path.toLowerCase() === repo.toLowerCase()
  );
  if (exact) {
    return exact.path_with_namespace;
  }

  const bySuffix = projects.find((project) =>
    project.path_with_namespace.toLowerCase().endsWith(`/${repo.toLowerCase()}`)
  );
  if (bySuffix) {
    return bySuffix.path_with_namespace;
  }

  return env.GITLAB_TASKS_FALLBACK_PROJECT;
}

/**
 * Resolves usernames to numeric user IDs, dropping any that don't exist.
 *
 * @param usernames GitLab usernames from assignment tags.
 * @returns the matching user IDs.
 */
export async function resolveAssigneeIds(
  usernames: string[]
): Promise<number[]> {
  const ids: number[] = [];

  for (const username of usernames) {
    try {
      const users = await request<GitLabUser[]>(
        `/users?username=${encodeURIComponent(username)}`
      );
      if (users[0]) {
        ids.push(users[0].id);
      } else {
        Logger.info("task", `No GitLab user matches "${username}", skipping`);
      }
    } catch (_err) {
      // A bad username shouldn't sink the whole issue.
      Logger.info("task", `Could not resolve GitLab user "${username}"`);
    }
  }

  return ids;
}

/**
 * Creates an issue.
 *
 * @param projectPath Namespaced project path, e.g. "group/project".
 */
export function createIssue(
  projectPath: string,
  issue: {
    title: string;
    description?: string;
    dueDate?: string;
    assigneeIds?: number[];
  }
): Promise<GitLabIssue> {
  return request<GitLabIssue>(
    `/projects/${encodeURIComponent(projectPath)}/issues`,
    {
      method: "POST",
      body: {
        title: issue.title,
        description: issue.description,
        due_date: issue.dueDate,
        assignee_ids: issue.assigneeIds?.length ? issue.assigneeIds : undefined,
      },
    }
  );
}

/**
 * Fetches specific issues by iid in one request per project.
 *
 * @param projectPath Namespaced project path.
 * @param iids Issue iids to look up.
 */
export async function getIssuesByIid(
  projectPath: string,
  iids: number[]
): Promise<GitLabIssue[]> {
  if (!iids.length) {
    return [];
  }

  const params = iids.map((iid) => `iids[]=${iid}`).join("&");
  return request<GitLabIssue[]>(
    `/projects/${encodeURIComponent(projectPath)}/issues?${params}&per_page=100`
  );
}
