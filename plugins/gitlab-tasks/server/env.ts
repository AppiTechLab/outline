import { IsOptional, IsUrl } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";
import { CannotUseWithout } from "@server/utils/validators";

/**
 * Note the `GITLAB_TASKS_` prefix: the bundled `gitlab` plugin already owns
 * `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` for OAuth sign-in, which is a
 * separate concern from issue syncing.
 */
class GitLabTasksPluginEnvironment extends Environment {
  /** Base URL of the GitLab instance, e.g. https://gitlab.com */
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ["http", "https"] })
  @CannotUseWithout("GITLAB_TASKS_TOKEN")
  public GITLAB_TASKS_URL = this.toOptionalString(
    environment.GITLAB_TASKS_URL
  );

  /**
   * Personal access token with the `api` scope. Every issue is created as this
   * token's user, so use a dedicated bot account if attribution matters.
   *
   * Supports Docker's `_FILE` convention via GITLAB_TASKS_TOKEN_FILE.
   */
  @IsOptional()
  @CannotUseWithout("GITLAB_TASKS_URL")
  public GITLAB_TASKS_TOKEN = this.toOptionalString(
    environment.GITLAB_TASKS_TOKEN
  );

  /**
   * Project path used when a task's repository tag matches nothing, e.g.
   * "mygroup/inbox". Tasks pointing at an unknown repo are skipped when unset.
   */
  @IsOptional()
  public GITLAB_TASKS_FALLBACK_PROJECT = this.toOptionalString(
    environment.GITLAB_TASKS_FALLBACK_PROJECT
  );

  /** Tag namespace. `PM` yields #PM/gitlab/… and #PM/assign/… */
  @IsOptional()
  public GITLAB_TASKS_TAG_PREFIX =
    environment.GITLAB_TASKS_TAG_PREFIX ?? "PM";

  /** Tag stamped onto a task once its issue exists. */
  @IsOptional()
  public GITLAB_TASKS_SYNCED_TAG =
    environment.GITLAB_TASKS_SYNCED_TAG ?? "#synced";

  /**
   * Self-hosted GitLab on a private network needs this, since outgoing
   * requests are otherwise blocked from reaching private IP ranges.
   */
  @IsOptional()
  public GITLAB_TASKS_ALLOW_PRIVATE_IP = this.toBoolean(
    environment.GITLAB_TASKS_ALLOW_PRIVATE_IP ?? "false"
  );
}

export default new GitLabTasksPluginEnvironment();
