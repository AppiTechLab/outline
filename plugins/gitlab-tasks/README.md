# GitLab Tasks

Pushes tagged Outline tasks to GitLab as issues, and ticks tasks back off when
their issue is closed. The routing tags match obsidian-gitlab-tasks, with one
deliberate difference: due dates are written as `[due:: YYYY-MM-DD]` rather than
`📅`, matching the `tasks` plugin.

## Configuration

In `deploy/.env`:

```bash
GITLAB_TASKS_URL=https://gitlab.example.com
GITLAB_TASKS_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_TASKS_FALLBACK_PROJECT=mygroup/inbox
```

The token needs the **`api`** scope (User Settings → Access Tokens). It also
supports Docker's `_FILE` convention — `GITLAB_TASKS_TOKEN_FILE=/run/secrets/x`
works if you'd rather not put it in `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITLAB_TASKS_URL` | — | Instance base URL. Required. |
| `GITLAB_TASKS_TOKEN` | — | PAT with `api` scope. Required. |
| `GITLAB_TASKS_FALLBACK_PROJECT` | — | Where tasks go when the repo tag matches nothing. Unset means skip them. |
| `GITLAB_TASKS_TAG_PREFIX` | `PM` | Tag namespace: `#PM/gitlab/…`, `#PM/assign/…` |
| `GITLAB_TASKS_SYNCED_TAG` | `#synced` | Stamped onto a task once pushed. |
| `GITLAB_TASKS_ALLOW_PRIVATE_IP` | `false` | Set true for a self-hosted GitLab on a private network — outgoing requests are otherwise SSRF-filtered. |

The plugin registers no routes until `GITLAB_TASKS_URL` and
`GITLAB_TASKS_TOKEN` are both set.

**One token for the whole server.** Every issue is created by that token's
user, so use a dedicated bot account if GitLab attribution matters. This is the
main thing that differs from the Obsidian plugin, which is inherently
single-user.

## Writing tasks

```markdown
- [ ] Fix the login page #PM/gitlab/myrepo
- [ ] Prepare interviews #PM/gitlab/xr4inclusion #PM/assign/lr [due:: 2026-08-20]
```

| Tag | Effect |
| --- | --- |
| `#PM/gitlab/<repo>` | **Required.** Routes the task to a GitLab project. Nothing syncs without it. |
| `#PM/assign/<username>` | Assigns the issue. Repeatable. Unknown usernames are skipped, not fatal. |
| `[due:: YYYY-MM-DD]` | Sets the issue due date. Same syntax as the `tasks` plugin. |

Dates are Dataview fields only. The Obsidian emoji form (`📅 2026-08-20`) is
**not** parsed — there is one way to write a date, and it's the one the `tasks`
plugin already understands. If you paste a line in from an Obsidian vault, the
emoji carries through into the GitLab issue title, which is the visible sign
that the due date didn't take.

The issue title is the task text with tags and inline fields removed. The
description carries a link back to the Outline document.

After a push the task line gains a stamp:

```markdown
- [ ] Fix the login page #PM/gitlab/myrepo #synced [GL-#42](https://gitlab.example.com/g/p/-/issues/42)
```

That stamp is what makes the task skippable on the next push and findable on
pull.

## Syncing

Three endpoints, all `POST`, all taking an optional `documentId` to narrow the
scope and `dryRun: true` to preview:

| Endpoint | Does |
| --- | --- |
| `/api/gitlabTasks.status` | Reports configuration and verifies the token by resolving the account it belongs to. |
| `/api/gitlabTasks.push` | Creates issues for tagged tasks without one, then stamps them. |
| `/api/gitlabTasks.pull` | Ticks tasks whose linked issue is now closed. |

### Day to day

**Settings → Workspace → GitLab Tasks.** Four buttons: Preview and Push,
Preview and Pull. Results are grouped by outcome with the reason against each,
and created issues link straight to GitLab.

Admin only — syncing edits other people's documents and creates issues under a
shared token, so it isn't a per-user action.

Always Preview before Push the first time. It sweeps every document you can
read, and fifty accidental issues are tedious to undo.

### From the command line

`deploy/gitlab-sync.ps1` does the same thing without a browser, which is what
you want for scripting or when the UI isn't reachable:

```powershell
cd D:\Projects\outline\deploy
$env:OUTLINE_API_TOKEN = "ol_api_..."   # Settings -> API and Access

.\gitlab-sync.ps1 status          # check config and token before anything else
.\gitlab-sync.ps1 push -DryRun    # what would be created
.\gitlab-sync.ps1 push            # create the issues
.\gitlab-sync.ps1 pull            # tick tasks whose issue closed
```

Add `-DocumentId <uuid>` to limit any of them to a single document, which is the
sane way to try it the first time.

Results are grouped by outcome — `created`, `completed`, `skipped`, `failed` —
with the reason against each and the document it came from.

### By hand

```bash
curl -X POST https://your-outline/api/gitlabTasks.push \
  -H "Authorization: Bearer $OUTLINE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

Each result carries `status` — `created`, `completed`, `skipped` or `failed` —
plus a `detail` explaining why. One task failing never aborts the run.

## How writeback works

This is the part worth understanding, because naively rewriting a document
breaks collaborative editing.

Task lines are patched through `documentUpdater` in `TextEditMode.Patch`, with
the untouched original line as `findText`. That path:

1. serializes the document to markdown with block positions,
2. maps the matched span back to ProseMirror positions,
3. patches surgically so sibling content is preserved,
4. **rewrites the Yjs state** via `updateYFragment`, and
5. fires `APIUpdateExtension.notifyUpdate`, which pushes the change into any
   live editing session.

Two consequences:

- Documents must be loaded with their `state` column. The workspace-wide scan
  uses `Document.scope("withState")` for exactly this reason — without it the
  markdown would be patched while the collaborative state stayed stale, and the
  next editing session would silently revert the change.
- Patching is sequential per document and mutates the loaded instance, so a
  document with several tagged tasks resolves each `findText` against the
  already-updated markdown.

## Known limitations

- **Duplicate task lines.** `findText` resolves with `markdown.indexOf`, so two
  byte-identical unsynced task lines in one document both resolve to the first.
  Tasks that already carry an issue link are unique by construction, so this
  only affects push, and only for genuinely identical text.
- **No milestones, work-package or activity labels.** The Obsidian plugin maps
  these through a `projects.json` registry; that's not implemented here.
- **No automatic `Status::Inbox` label.**
- **Manual trigger only.** No scheduled sync. Adding one is a `Hook.Task` plus a
  cron registration — the sync logic itself needs no changes.
- **Push does not update existing issues.** A synced task whose text later
  changes leaves the GitLab issue as it was.
- **Closing a task in Outline does not close the GitLab issue.** Pull is
  one-directional: GitLab is authoritative for closure.

## Files

```
plugins/gitlab-tasks/
  plugin.json
  shared/types.ts              TaggedTask, SyncResult, GitLab shapes
  shared/parser.ts             tag extraction, issue-link parsing, line stamping
  shared/parser.test.ts        36 unit tests, no database needed
  server/env.ts                GITLAB_TASKS_* configuration
  server/gitlab.ts             REST v4 client over Outline's SSRF-guarded fetch
  server/index.ts              registers the API hook when configured
  server/api/gitlabTasks.ts    status / push / pull
  server/api/schema.ts         request validation
  client/Settings.tsx          the sync UI
  client/index.tsx             Hook.Settings
  client/Icon.tsx
```

No core files are patched — this plugin is entirely self-contained.

## Testing

```bash
yarn test plugins/gitlab-tasks
```

Then, against a running instance:

1. `POST /api/gitlabTasks.status` — expect `configured: true` and your bot's
   `account`. A populated `error` means the token is wrong or the instance is
   unreachable.
2. Write a task with `#PM/gitlab/<a real repo>` in a document, optionally with
   `[due:: 2026-08-20]`.
3. `POST /api/gitlabTasks.push` with `{"dryRun": true}` — expect one `created`
   result saying which project it would land in.
4. Repeat without `dryRun`. Check the issue exists and the task line gained its
   `#synced [GL-#n](…)` stamp.
5. Close the issue in GitLab, then `POST /api/gitlabTasks.pull`. The task's
   checkbox should tick — including in a browser tab you left open, which
   confirms the Yjs writeback worked.
