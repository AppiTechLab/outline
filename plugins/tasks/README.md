# Tasks

Obsidian-Tasks-style task management for Outline. Annotate any checkbox with
Dataview-style inline fields, then query them across every document you can
read with a ```` ```tasks ```` code block.

## Writing tasks

A task is any checkbox list item. Metadata goes in `[key:: value]` anywhere on
the line; tags are plain `#tags`.

```markdown
- [ ] Draft the Q3 proposal [due:: 2026-08-12] [priority:: high] #work
- [ ] Book the venue [scheduled:: 2026-08-01] [due:: 2026-08-20] #events
- [x] Send invoices [due:: 2026-08-01] [done:: 2026-08-01] #admin
- [ ] Water the plants [repeat:: every week]
```

### Fields

| Field | Meaning |
| --- | --- |
| `due` | When it must be finished |
| `scheduled` | When you plan to work on it |
| `start` | Not actionable before this date |
| `created` | When it was written down |
| `done` | When it was completed |
| `cancelled` | When it was abandoned |
| `priority` | `none`, `lowest`, `low`, `medium`, `high`, `highest` |
| `repeat` | Recurrence text — **stored and displayed, but not yet acted on** |

Dates are `YYYY-MM-DD`, or the keywords `today`, `tomorrow`, `yesterday`.
Malformed dates are ignored rather than erroring, so a typo means the field is
simply absent.

Fields are stripped from the rendered task text; tags are kept inline.

## Querying

Put one instruction per line inside a fenced block with the `tasks` language.
Blank lines and lines starting with `#` are ignored.

````markdown
```tasks
not done
due before today
sort by priority
limit 20
```
````

Every filter is combined with AND.

### Filters

```
done
not done

due before 2026-09-01
due after today
due on 2026-08-12
due on or before today
due on or after 2026-01-01
```

Any date field works in place of `due`: `scheduled`, `start`, `created`,
`done`, `cancelled`.

```
no due date
has scheduled date

priority is high
priority is not none
priority above medium
priority below high

tag includes work
tag does not include archive

text includes review
text does not include draft

path includes Engineering
path does not include Archive
```

`path` matches against the collection name and the document title.

### Sorting and display

```
sort by due
sort by priority reverse
limit 20
hide path
show path
```

Sort keys: `due`, `scheduled`, `start`, `created`, `done`, `priority`, `text`,
`path`. Multiple `sort by` lines are applied in order. Tasks missing the sorted
date always sort last, in either direction — an undated task is not "earliest".

Unrecognised lines don't fail the query; they're listed above the results so a
typo is visible rather than silently returning nothing.

## How it works

Tasks are parsed **at query time** rather than kept in an index. A `tasks.list`
request selects documents in collections you can read, prefiltered in SQL to
those containing a checkbox, deserializes each one's ProseMirror content and
walks it for `checkbox_item` nodes.

That means results are never stale and there is no migration or background job
to go wrong. The trade-off is that cost scales with the number of documents
containing checkboxes; the scan is capped at the 1500 most recently updated
matching documents, and the result footer says so when that cap is hit. Past a
few thousand such documents you'd want a real index — see "If you outgrow this"
below.

Permissions come from `user.collectionIds()`, the same list `documents.list`
uses, so a query can never surface a task from a collection you can't open.

## Testing it works

### 1. Is the plugin in the image?

```bash
docker compose exec outline ls build/plugins/tasks/server
```

Expect `api` and `index.js`. If the directory is missing, the build predates
the plugin — rebuild with `docker compose up -d --build`.

### 2. Is the route mounted?

```bash
docker compose exec outline sh -c \
  "wget -qO- --header='Content-Type: application/json' --post-data='{}' http://localhost:3000/api/tasks.list; echo"
```

An **authentication error** is the success case: the route exists and rejected
an unauthenticated call. A **404** means the plugin didn't register — check
`docker compose logs outline` for "Failed to load plugin".

### 3. Does it find tasks?

Create a document and paste:

```markdown
- [ ] Overdue thing [due:: 2026-08-01] [priority:: high] #work
- [ ] Due today [due:: 2026-08-06] #work
- [ ] Next fortnight [due:: 2026-08-20] [priority:: low] #work
- [ ] Undated but urgent [priority:: highest] #home
- [x] Already finished [due:: 2026-08-02] [done:: 2026-08-02] #work
```

The `[due:: …]` annotations should disappear from the rendered text while the
`#tags` stay — that confirms the parser ran.

### 4. Does the query block render?

In the same document (or a different one — queries span the workspace), insert
a code block and set its language to **Tasks query** from the dropdown. Typing
` ```tasks ` will *not* work: `CodeFence`'s input rule matches bare ` ``` ` only
and doesn't capture a language. Pasting markdown that contains a ```` ```tasks ````
fence does work, because `parseMarkdown` reads the language off the token.

Then type inside it:

```
not done
due before 2026-08-07
sort by priority
```

Expect two results — "Overdue thing" and "Due today" — with the overdue one's
date in red, and a footer counting them. Results appear about 600ms after you
stop typing.

Worth also trying a deliberate typo, e.g. `sort by colour`, which should render
a red explanation above the results rather than silently returning nothing.

### 5. Unit tests

The parser and query engine have 42 tests that need no database:

```bash
yarn test plugins/tasks
```

This needs a local `yarn install`; there's no test runner in the runtime image
because `yarn workspaces focus --production` strips devDependencies.

## Files

Plugin (no core code, safe across upgrades):

```
plugins/tasks/
  plugin.json
  shared/types.ts          Task, Filter, Sort, TaskQuery
  shared/parser.ts         [key:: value] and #tag extraction, date handling
  shared/query.ts          query language parser and evaluator
  shared/*.test.ts         42 unit tests, no database needed
  server/index.ts          registers the API hook
  server/api/tasks.ts      POST /api/tasks.list
  server/api/schema.ts     request validation
```

Core files patched (see "Upgrade notes"):

```
shared/editor/extensions/TasksQuery.ts   new — renders results under the block
shared/editor/nodes/index.ts             +2 lines — registers the extension
shared/editor/lib/code.ts                +5 lines — adds the `tasks` language
```

## Upgrade notes

Outline's plugin API can't register editor nodes or extensions —
`shared/editor/nodes/index.ts` is a static import list. Inline query blocks
therefore need those three core files touched. Keep the diff small and check it
after pulling upstream:

```bash
git diff upstream/main -- shared/editor/nodes/index.ts shared/editor/lib/code.ts
```

The only realistic breakages are upstream reorganising the extension list or
renaming `code_fence`. Everything else lives in `plugins/tasks/`, which upstream
never touches.

## Not implemented

- **Recurrence.** `repeat::` is parsed and stored but completing a task does not
  create the next occurrence.
- **Toggling from results.** The rendered list is read-only; tick the box in the
  source document. Writing back means editing another document's ProseMirror
  state through the collaboration server, which is a much larger change.
- **Grouping.** No `group by` yet; `sort by` covers most of the same need.
- **Task dependencies.** No `id::` / `depends::`.

## If you outgrow this

Switching to an index is a contained change: add a `tasks` table, register a
`Hook.Processor` on `documents.update` to reindex, and swap the document scan in
`server/api/tasks.ts` for a query against it. The parser, query language and
editor extension all stay as they are. Note that migrations live in
`server/migrations`, so that step adds another core patch.
