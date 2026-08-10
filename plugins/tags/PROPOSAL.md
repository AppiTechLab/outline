# Document tags — scoping

> ## What actually happened
>
> **This document recommended Tier 0 and stopping. Tiers 0, 2 and 3 were built.**
> Read the rest of it as a record of the reasoning, not as a description of the
> system — for that, see `README.md`.
>
> Each step was requested and each was individually reasonable: highlight the
> tags, autocomplete them, give each one a page, list them in the sidebar. None
> was flagged at the time as the thing this document warned against. The cost
> was never re-added up until it was eleven core files.
>
> ### The original decision still holds
>
> [SilverBullet](https://silverbullet.md) ships all of this natively — it
> indexes pages, links, list items, tasks and headers, supports user-defined tag
> types, and queries them inline with Space Lua. It is ruled out because
> **colleagues will edit**: it has no multi-user support and no editing
> permissions, and collaborative editing was removed upstream as too complex to
> maintain. Read-only publishing is its only sharing model.
>
> So this was not the wrong tool. It was the wrong scope. The distinction
> matters if you are ever tempted to reopen the choice: the constraint that
> ruled SilverBullet out has not moved.
>
> ### What is genuinely ours
>
> Worth keeping in view, because it is the part that justifies the cost:
>
> - **A controlled vocabulary with real governance.** The taxonomy is a
>   permissioned document with revision history — who may change it, and who
>   changed it when, come free from Outline. SilverBullet's tags are an
>   uncontrolled folksonomy. With several editors this is the actual
>   differentiator, and it is why the sidebar tree is even viable: a bounded list
>   fits, a folksonomy would not.
> - **GitLab issue sync** with CRDT-safe writeback (`plugins/gitlab-tasks`).
>
> Tags, nesting, tag pages, autocomplete and the sidebar are reimplementation.
>
> ### Recommendation: stop here
>
> Not because anything is broken, but because the next request will also sound
> reasonable. If maintenance turns painful after an upgrade, the removable
> surface is exactly the eleven files below — the parsers, APIs, Settings page
> and GitLab sync are plugin-only and survive their removal intact.
>
> ### Core files to check after every upstream merge
>
> | File | Why it was touched | Risk |
> | --- | --- | --- |
> | `shared/editor/extensions/TasksQuery.ts` | New. Renders ```` ```tasks ```` results | Low — self-contained |
> | `shared/editor/nodes/index.ts` | Registers the above | Low — static list, additive |
> | `shared/editor/lib/code.ts` | Adds the `tasks` language | Low — additive |
> | `app/editor/extensions/TagMenu.tsx` | New. `#` autocomplete | **High** — overrides `Suggestion`'s input rule; see README |
> | `app/editor/components/TagMenu.tsx` | New. The menu itself | Medium — depends on `SuggestionsMenu`'s item contract |
> | `app/editor/extensions/TagHighlight.ts` | New. Highlights, anchors, clicks | Medium — depends on `Editor.scrollToAnchor` |
> | `app/editor/extensions/index.ts` | Registers both | Low — additive |
> | `app/scenes/Tags/index.tsx` | New. One-line re-export | Low |
> | `app/routes/scenes.ts` | Lazy scene | Low — additive |
> | `app/routes/authenticated.tsx` | `/tags/:tag+` route | Low — additive |
> | `app/components/Sidebar/App.tsx` | The Tags section | **High** — most churned upstream |
>
> Plus `.dockerignore`, which gained `**/.env` so `deploy/.env` stays out of the
> build context — unrelated to tags, but part of the same diff.
>
> ```bash
> git diff upstream/main -- shared/editor app/editor app/routes app/scenes/Tags \
>   app/components/Sidebar/App.tsx .dockerignore
> ```

---

Outline has no tag primitive. This is what it would take to add one, in tiers,
so you can stop at the point where the cost stops being worth it.

The dividing line throughout is **plugin code versus core patches**. Outline's
plugin API can register API routes, queue processors, background tasks and
*settings* screens. It cannot register editor nodes or marks, database
migrations, sidebar entries, or search filters — those live in static lists and
directories that a plugin can't reach. Every core patch is a permanent diff you
re-resolve on each upstream merge.

## What exists today

- No `Tag` or `Label` model, no `tags` column, no hashtag mark in the editor
  schema. `#work` is literal text.
- Search is Postgres full-text: `searchVector @@ to_tsquery('english', …)`.
  Filters are `collectionId`, `userId`, `documentId`, `statusFilter` and a date
  range.
- `#` is punctuation to `to_tsquery`, so an unquoted `#work` search matches the
  lexeme `work` — same results as the plain word.
- **Quoted phrases bypass tsquery.** `PostgresSearchProvider` extracts them and
  runs `ILIKE '%…%'` against title and text instead, up to 3 per query. So
  `"#work"` already does a literal tag match. This is the cheapest thing
  available and costs nothing to adopt.

---

## Tier 0 — query-time scan · **0 core patches**

Same approach as the `tasks` plugin: no storage, parse on demand.

A `tags.list` endpoint scans documents the user can read, prefiltered in SQL to
those containing `#`, extracts hashtags and returns them with counts.
`tags.documents` returns the documents carrying a given tag.

```
plugins/tags/
  shared/parser.ts        hashtag extraction, shared with the client
  server/api/tags.ts      tags.list, tags.documents
  server/index.ts         Hook.API
  client/Settings.tsx     a Tags browser under Settings
  client/index.tsx        Hook.Settings
```

The client `Hook.Settings` is the useful trick here: a browsable tag list with
counts and click-through, reachable from the Settings sidebar, **without
touching core**.

- **Get:** tag listing, counts, click-to-see-documents, tag filtering in the
  `tasks` plugin you already have.
- **Don't get:** tags styled in the editor, autocomplete, a top-level sidebar
  entry, tag filtering inside Outline's own search box.
- **Cost:** ~400 lines. Scales to a few thousand documents; every listing reads
  every document containing a `#`.

## Tier 1 — indexed tags · **1 core patch**

Adds a `document_tags` table plus a `Hook.Processor` on `documents.update` that
reindexes a document's tags on save.

```
server/migrations/2026…-create-document-tags.js   ← the only core file
plugins/tags/server/processors/TagIndexProcessor.ts
plugins/tags/server/models/DocumentTag.ts
```

Migrations must live in `server/migrations` — `.sequelizerc` hardcodes the path,
so this cannot be a plugin file. One migration among 299 existing ones is
low-conflict: upstream adds files there, it doesn't rewrite yours.

- **Get:** instant tag queries at any size, sortable and countable in SQL.
- **Cost over Tier 0:** ~250 lines, plus a backfill script for existing
  documents, plus the standing risk of index drift. `shouldQueue` keeps the
  processor cheap by skipping events for documents with no `#`.
- **Worth it when:** Tier 0 listing gets slow. Not before.

## Tier 2 — tags look like tags · **3 core patches**

A `Hashtag` mark so `#work` renders as a chip and is clickable.

```
shared/editor/marks/Hashtag.ts        new file
shared/editor/nodes/index.ts          +2 lines, register in richExtensions
shared/editor/rules/hashtag.ts        new markdown-it rule
```

Same constraint that forced the `tasks` query block into core:
`shared/editor/nodes/index.ts` is a static import list.

The mark must serialize back to plain `#work` in markdown, or documents stop
round-tripping and every existing tag breaks. That's the main risk, and it's
testable in isolation.

- **Get:** visual tags, clickable to filter.
- **Cost:** ~300 lines and real editor-schema care. Mark input rules that fire
  mid-word are a common source of bugs — `#` inside a URL or a code span must
  not become a tag.

## Tier 3 — autocomplete and sidebar · **3+ core patches**

- `#` trigger in `app/editor/extensions/Suggestion.ts` — core, and the mention
  menu's assumptions are `@`-shaped.
- A top-level "Tags" sidebar entry — core; client plugins only get
  `Settings`, `Imports` and `Icon` hooks.
- A `tags` filter on `documents.search` — core, touching both the request schema
  and `PostgresSearchProvider`.

- **Cost:** roughly the same again as Tiers 0–2 combined, spread across the
  parts of the client most likely to be refactored upstream.

---

## Recommendation *(superseded — see the top of this file)*

**Build Tier 0. Adopt the quoted-search trick immediately, it's free.**

Tier 0 gets you the thing you actually asked about — finding documents by tag —
with no core diff at all, which matters because you're already carrying three
patched files for the `tasks` block. Tier 1 is a clean upgrade later and doesn't
invalidate Tier 0's parser or API.

Tier 2 is where I'd pause. It's the first tier whose benefit is cosmetic while
its risk is not: a mark that mis-serializes corrupts documents rather than just
looking wrong.

Tier 3 is only worth it if tags become a primary navigation mechanism rather
than an occasional filter.

## Open questions

1. **Tag scope.** Workspace-wide, or namespaced per collection? Affects the
   uniqueness key in Tier 1.
2. **Nested tags.** Does `#project/alpha` imply membership of `#project`? Cheap
   to support in the parser, awkward to retrofit afterwards.
3. **Case.** Are `#Work` and `#work` the same tag? Recommend folding to
   lowercase for matching while preserving the first-seen casing for display.
4. **Interaction with task tags.** The `tasks` plugin already parses `#tags` per
   task. Should document tags include tags that only appear inside a task line,
   or exclude them so the two stay distinct?
