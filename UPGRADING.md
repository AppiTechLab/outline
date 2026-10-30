# Upgrading from upstream Outline

This tree carries deliberate patches to Outline's core. They are additive and
small, but they mean an upgrade is a review, not a `git pull`.

Read *Why this needs care* once. After that, the checklist is the whole job.

---

## Why this needs care

Failures come in three kinds, in increasing order of danger.

**Merge conflicts.** Loud and easy. Every core edit here is an import plus a
list entry, so conflicts are small. Git tells you where they are.

**Silent breakage.** The dangerous kind. Six *new* files never conflict —
upstream doesn't know they exist — they simply stop working. Nothing throws;
the `#` menu just stops opening, or a query block returns nothing. This is why
the manual checks at the end are not optional.

**Migrations.** They run automatically on boot. Once the app starts, the schema
has moved forward and rolling back needs a database restore, not a
`git checkout`. Back up first.

---

## The checklist

### 0. See how much care this needs

```powershell
git fetch upstream --tags
git log --oneline HEAD..upstream/main -- ":/app" ":/shared/editor"
```

**The `:/` prefix matters.** Git pathspecs are relative to your current
directory, so `-- app/editor` run from `deploy\` silently matches nothing and
reports a clean bill of health for a merge that will conflict. `:/` anchors to
the repository root.

Empty means nothing upstream touched the areas you've patched — rebuild and
smoke test. Non-empty means read the commit titles first; they usually tell you
what will conflict and what to test afterwards.

### 1. Back up

```powershell
cd D:\Projects\outline\deploy
docker compose exec -T postgres pg_dump -U outline outline | gzip > backup-$(Get-Date -Format yyyy-MM-dd).sql.gz
```

Migrations are one-way. This is the only way back.

### 2. Merge upstream — on your own machine, not the server

The VM's outbound access is limited to `gitlab.com` and `gitlab.hevs.ch`. It
cannot reach GitHub, so it can never merge from upstream. That's a feature:
the server only ever deploys an already-resolved result.

Remotes on your machine:

| | |
| --- | --- |
| `upstream` | `github.com/outline/outline` — read only, never pushed to |
| `origin` | `github.com/AppiTechLab/outline` for fetch, pushing to **both** GitHub and `gitlab.com/appitech/internal/wiki` |

That second push URL is what the server pulls from.

```powershell
cd D:\Projects\outline
git fetch upstream --tags
git switch -c upgrade-$(Get-Date -Format yyyy-MM-dd)
git merge upstream/main
```

Resolving on a branch means `main` stays runnable if you abandon it.

Note the version lives in `package.json` and is bumped in a release commit. If
`upstream/main` still shows the old version, the release is a tag that hasn't
landed on main — merge `v1.9.2` rather than `upstream/main`.

### 3. Review your own diff

```powershell
git diff --ignore-cr-at-eol HEAD@{1} -- shared/editor app/editor app/routes app/scenes app/components .dockerignore
```

`--ignore-cr-at-eol` is belt and braces; `.gitattributes` should keep line
endings clean, but a checkout made before it was added may still be noisy.

### 4. Rebuild

```powershell
cd deploy
docker compose up -d --build
docker compose logs -f outline
```

Watch for `Running migrations…` and `Failed to load plugin`.

### 5. Verify by hand

**Nothing below fails loudly. Actually do these.**

| Check | Expected | If it fails |
| --- | --- | --- |
| Type `#w` mid-sentence in a document | Vocabulary menu appears | `TagMenu.tsx` — see *Fragile couplings* |
| Insert a **Tasks query** code block with `not done` | Results render below it | `TasksQuery.ts` |
| Click a highlighted tag | Opens `/tags/<tag>` | `TagHighlight.ts` route or click handler |
| Click a line on a tag page | Document opens scrolled to it | `scrollToAnchor` contract |
| Sidebar → **Tags** | Tree of the vocabulary | `Sidebar/App.tsx` merge |
| `POST /api/tags.vocabulary` | Your tags, `unconfigured: false` | Server plugin or vocabulary document |
| `POST /api/gitlabTasks.status` | `configured: true`, your bot account | `gitlab-tasks` env or GitLab API |
| Sign in via GitLab | Lands in your existing account | OIDC config |

### 6. Merge back and publish

```powershell
git switch main
git merge upgrade-YYYY-MM-DD
git push origin main          # goes to GitHub and GitLab
```

### 7. Deploy on the server

Only now, and only from GitLab:

```bash
cd /opt/apps/outline
git pull
cd deploy
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Steps 1 and 5 apply again here — back up the database first, and re-run the
manual checks against the real instance. Verifying locally proves the merge
resolved; it doesn't prove the deployment works.

---

## Fragile couplings

Where the new files reach into upstream internals. If a check above fails, start
here.

| File | Depends on | Symptom when it breaks |
| --- | --- | --- |
| `app/editor/extensions/TagMenu.tsx` | Overrides `Suggestion`'s input rule to bypass its `match[0].length <= 2` guard | `#` menu never opens, or opens only at line start |
| `app/editor/components/TagMenu.tsx` | `SuggestionsMenu` calling `onClick` for items named `noop` | Menu appears, selecting a tag inserts nothing |
| `app/editor/extensions/TagHighlight.ts` | `Editor.scrollToAnchor` resolving `window.location.hash` to an element | Tags highlight, but line links land at the top of the document |
| `shared/editor/extensions/TasksQuery.ts` | The fence node being named `code_fence`; `Extension.allowInReadOnly` | Query blocks render as plain code |
| `shared/editor/lib/code.ts` (`tasks`, `htmlpreview` entries) | `refractor` import paths — v1.12.0 moved to refractor 5, where `refractor/lang/yaml` became `refractor/yaml` | Client build fails: cannot resolve `refractor/lang/…`. Merges cleanly, so only the build catches it |
| `app/components/Sidebar/App.tsx` | The surrounding sidebar structure | Conflicts loudly — the good kind |
| `plugins/*/server` | `DocumentHelper.toMarkdown`, `documentUpdater` patch mode, `PluginManager` hooks | API errors, visible in logs |

### Precedent: the August 2026 sidebar conflict

Upstream #13505 made sidebar sections drag-reorderable, replacing the hardcoded
`<Section>` list with `sectionOrder.map()` over a `SidebarSection` enum. Our
`<TagsLink />` sat exactly there and conflicted.

Resolution, and the one to repeat: **keep upstream's structure, append the Tags
`<Section>` after the loop.** Tags stays outside the reorderable set — adding it
to the enum would mean patching `@shared/types` as well, a further core file so
that one section can be dragged. Not worth it.

### Already scheduled to break

`Document.text` carries an upstream comment: *"This column will be removed in a
future migration."* Both `plugins/tags` and `plugins/gitlab-tasks` use it as a
cheap SQL prefilter.

When it goes, tag scanning and task sync return nothing — silently. The fix is
small: drop the `text` clause from the `[Op.or]` prefilters and rely on the
`content::text` one, which is already there and already the primary. Worth doing
proactively if you see the column deprecated in a release note.

Note the *reading* path is already correct — both plugins serialize from
`content` rather than trusting `text`, since `documentCollaborativeUpdater`
never writes that column. Only the prefilters still mention it.

---

## If an upgrade goes badly

```powershell
cd D:\Projects\outline
git switch main                    # your branch is abandoned, main is untouched

cd deploy
docker compose down
docker volume rm outline_postgres-data
docker compose up -d               # recreates an empty database
Get-Content backup-YYYY-MM-DD.sql.gz | gzip -d | docker compose exec -T postgres psql -U outline outline
```

Restore is only necessary if the failed upgrade ran migrations. If the app never
started successfully, the schema is untouched and switching branches is enough.

---

## What is safe

Reassuring, since most of the tree is:

- **`plugins/tasks`, `plugins/tags`, `plugins/gitlab-tasks`** — upstream never
  touches these directories. `build.js` discovers plugins by listing
  `./plugins`, so they're picked up with no registration to maintain.
- **`deploy/`** — entirely yours.
- **Unit tests** — `yarn test plugins/tasks plugins/tags plugins/gitlab-tasks`
  covers the parsers and query language with no database. Run it after a merge;
  it won't catch UI breakage but it will catch a changed dependency.

The eleven core files are the whole risk surface. `plugins/tags/PROPOSAL.md`
lists them with per-file risk ratings and records why they exist.
