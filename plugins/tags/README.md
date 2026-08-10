# Tags

A controlled tag vocabulary for Outline, with `#` autocomplete.

Outline has no tag primitive — a tag is just `#word` in the text. This plugin
reads them at query time, checks them against a vocabulary you maintain as a
normal wiki page, and offers that vocabulary when you type `#`.

`PROPOSAL.md` records what this was scoped to be, what it became, and the
eleven core files to check after an upstream merge. Read it before adding
anything else here.

## The vocabulary document

Create a document titled **Tag vocabulary**. Every `#tag` written in it is
approved — no special syntax, so it can be a readable page:

```markdown
# Tag vocabulary

## Work packages
#wp1 — Management
#wp2 — Needs analysis

## Status
#blocked · waiting on someone outside the team
#review · ready for a second pair of eyes
```

Because it's an ordinary document, Outline already gives you the governance:
collection permissions decide who may change the taxonomy, and revision history
records who changed it and when. Nothing new to back up.

Nested tags roll up. Approving `#project/alpha` also approves `#project`, and
`#project/alpha/spec` counts towards both.

**Until the document exists, every tag counts as approved.** A workspace that
hasn't opted in shouldn't suddenly see all its tags flagged.

### Pointing at a different document

| Variable | Default | Purpose |
| --- | --- | --- |
| `TAGS_VOCABULARY_DOCUMENT` | — | Document UUID or urlId. Overrides the title lookup. |
| `TAGS_VOCABULARY_TITLE` | `Tag vocabulary` | Title searched for when the above is unset. |
| `TAGS_VOCABULARY_TTL` | `60` | Seconds to cache the parsed vocabulary. |

The title match is case-insensitive, and the oldest document wins if there are
duplicates — so the vocabulary doesn't silently change when someone creates a
second one.

### When the vocabulary loads

There are two caches, and knowing which is which saves confusion:

- **Server**, 60s by default (`TAGS_VOCABULARY_TTL`). Shared by all users.
- **Editor**, in the browser tab. Fetched when a document editor mounts, so the
  list is in hand before anyone types `#`. Re-checked whenever the menu opens
  more than 2 minutes after the last fetch.

So an edit to the vocabulary document reaches open tabs within roughly the sum
of the two, without polling or a page reload. To skip the wait, use **reload**
in the tag browser — it clears both.

### Checking it loaded

```bash
curl -X POST https://your-outline/api/tags.vocabulary \
  -H "Authorization: Bearer $OUTLINE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

`unconfigured: true` means no vocabulary document was found. In order of
likelihood:

1. The title doesn't match `TAGS_VOCABULARY_TITLE` — check for a typo or a
   trailing space. Case doesn't matter.
2. The document is a draft, archived or in the trash — all three are excluded.
3. The document exists but contains no `#tags`, so the vocabulary is empty.

If the endpoint returns your tags but the menu still shows nothing, the
vocabulary is fine and the problem is the menu opening — see *Why the input rule
is overridden* below.

Note the lookup is not permission-filtered: the vocabulary document is found
anywhere in the team, so a taxonomy kept in a private admin collection still
works for everyone. Only the *tag counts* respect what each user can read.

## Autocomplete

Type `#` followed by at least one character and the approved tags appear.
Selecting one inserts plain text — `#wp2 ` — exactly what you'd have typed by
hand. Tags are never part of the document schema, so there is nothing to
serialize and no way for this to corrupt a document.

The menu does not open:

- on a bare `#`, so `# Heading` still works,
- inside code blocks or inline code, so `#include` and `#!/bin/sh` are safe,
- when the vocabulary is empty.

**Typing an off-list tag still works.** Outline edits through a CRDT
(Yjs/Hocuspocus), whose extension hooks observe changes rather than veto them.
Rejecting input would mean rewriting someone's sentence under their cursor. The
menu is what keeps the taxonomy clean in practice; the exception report below
catches what slips through.

## Highlighting and deep links

Tags render highlighted in documents. Clicking one opens its own page at
`/tags/<tag>`, listing every line that mentions it across the workspace — click
a line to open that document scrolled to that exact occurrence.

Nested tags keep their slashes as path segments, so `#PM/assign/Antoine` lives
at `/tags/pm/assign/antoine`. The route is declared `:tag+` to match them.

This works without adding anything to the document. Highlights are ProseMirror
**decorations**, so tags stay plain text: nothing new to serialize, no
migration, and every existing document lights up immediately.

The jump links reuse machinery that was already there. `Editor.scrollToAnchor`
watches for an element matching `window.location.hash`, scrolls to it and places
the cursor — that's how heading anchors work. `TagHighlight` emits an invisible
`<a id="tag-wp1-2">` beside each occurrence, so `/doc/slug#tag-wp1-2` needed no
new plumbing.

Anchor ids are numbered per tag in document order, and a nested tag counts
towards each ancestor: one `#PM/assign/Antoine` is simultaneously occurrence *n*
of `pm`, of `pm/assign` and of `pm/assign/antoine`, so it emits three anchors.
Client and server both derive ids from `anchorId()` in `shared/parser.ts` — if
those two ever disagreed, every deep link would break silently, which is why
the editor extension imports the function rather than reimplementing it.

Ordinary clicks navigate; cmd/ctrl/shift-click and clicking to place the caret
inside a tag to edit it all still behave normally.

Anchors are positional, so editing a document shifts them. They're jump links,
not permalinks — fine for "show me where this is", not for citing.

## The sidebar

A **Tags** section lists the vocabulary as a tree, each node linking to its own
page:

```
Tags
  #blocked
  #pm
    assign
      antoine
    project
      test
  #review
  #wp1
```

Indentation carries the hierarchy, so only the last segment is shown below the
top level. The vocabulary already contains every ancestor, so building the tree
is a sort plus a slash count — no assembly needed.

It reads the same module-level cache the `#` menu fills, so once a document has
been opened the sidebar costs no request at all. The section hides itself
entirely when the vocabulary is empty, rather than showing an empty disclosure.

The heading is a disclosure rather than a link — there is no "all tags" page,
and pointing it at an arbitrary first tag would be worse than pointing it
nowhere.

This is only viable because the vocabulary is curated. An uncontrolled
folksonomy would outgrow a sidebar within a month; a bounded list will not.

## The vocabulary page

**Settings → Workspace → Tags** is about the taxonomy rather than about finding
things — the per-tag results live at `/tags/<tag>`. It lists:

- **Approved** — vocabulary tags with a document count, including approved tags
  nobody has used yet, so the page reflects the taxonomy rather than only what's
  in use.
- **Not in the vocabulary** — tags in use but not approved, in red. Usually a
  typo; sometimes a tag worth promoting. Click one to see which documents use
  it.

The vocabulary document is excluded from counts, or every approved tag would
show as used once.

### What is not a tag

| Not matched | Why |
| --- | --- |
| `# Heading` | A heading's hash is followed by a space. |
| `https://example.com/page#section` | URLs are stripped before scanning. |
| `[docs](https://x/a#anchor)` | Link targets are stripped. |
| `` `#include <stdio.h>` `` | Inline code and fenced blocks are stripped. |
| `#fff`, `#DEADBEEF` | Hex-colour shaped. |
| `#1234` | A tag must start with a letter. |
| `page#section`, `C#` | A tag needs whitespace or a bracket before it. |

The colour check is length-plus-composition, so a real tag of 3, 4, 6 or 8
characters drawn only from `a`–`f` and digits is swallowed. `#dead` and `#fade`
are rejected; `#faded` is kept, because 5 isn't a valid hex length. Rare, and
the alternative is every CSS snippet polluting the tag list.

## Searching

Outline's own search box works, but only with quotes:

```
"#project/alpha"
```

Quoted phrases bypass `to_tsquery` and run as `ILIKE '%…%'`, so the `#` and `/`
survive. **Unquoted `#project` will not work** — the tokenizer strips
punctuation and you'd match the plain word `project`.

## API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/tags.list` | `collectionId?`, `nested?` | Approved and unrecognised tags with counts |
| `POST /api/tags.documents` | `tag`, `collectionId?`, `nested?` | Documents carrying that tag, each with the matching lines and an anchor per occurrence |
| `POST /api/tags.vocabulary` | — | The approved list. Consumed by the `#` menu. |
| `POST /api/tags.refresh` | — | Drops the vocabulary cache |

## Performance

Each request scans up to **2000** of the most recently updated documents that
plausibly contain a tag, prefiltered in Postgres with a POSIX pattern matching
`#` followed by a letter. Prefiltering on a bare `#` would be pointless — almost
every markdown document has a heading.

Markdown is read from the `text` column rather than deserializing the
ProseMirror tree per document. That column is deprecated upstream but still
written on every save, and the saving over a workspace-wide scan is large. The
tree is parsed only as a fallback when the column is empty.

Responses carry `scanned` and `truncated`. If `truncated` starts coming back
true, that's the signal to move to an indexed table — Tier 1 in `PROPOSAL.md`,
which reuses this parser and API unchanged.

## Files

Plugin — self-contained:

```
plugins/tags/
  PROPOSAL.md              why this scope and not more
  plugin.json
  shared/parser.ts         extraction, nesting, counting, normalisation
  shared/parser.test.ts    30 unit tests, no database needed
  server/env.ts            TAGS_VOCABULARY_* configuration
  server/vocabulary.ts     loads and caches the vocabulary document
  server/api/tags.ts       list, documents, vocabulary, refresh
  server/api/schema.ts
  server/index.ts          Hook.API
  client/Settings.tsx      the tag browser
  client/index.tsx         Hook.Settings
  client/Icon.tsx
```

Core patched — autocomplete cannot live in a plugin, since client plugins only
get the `Settings`, `Imports` and `Icon` hooks:

```
app/editor/extensions/TagMenu.tsx       new — Suggestion subclass on `#`
app/editor/components/TagMenu.tsx       new — the menu, fetches the vocabulary
app/editor/extensions/TagHighlight.ts   new — highlights, anchors, click handling
app/editor/extensions/index.ts          +6 lines, registers both extensions
app/scenes/Tags/index.tsx               new — one line, re-exports the scene
app/routes/scenes.ts                    +2 lines, lazy scene
app/routes/authenticated.tsx            +6 lines, the /tags/:tag+ route
app/components/Sidebar/App.tsx          +6 lines, the Tags section
```

`app/components/Sidebar/App.tsx` is the one to watch on upgrade — the sidebar
churns upstream more than the rest of this list.

The scene itself is `plugins/tags/client/TagScene.tsx`; `app/scenes/Tags` is a
one-line re-export so the routed component still lives beside the parser and API
it depends on. Client plugins can't register routes — only Settings, Imports and
Icon hooks — so those three core edits are the unavoidable minimum.

`TagHighlight` imports `anchorId` and `expandNested` from the plugin by relative
path. `tsconfig.json` maps `plugins/*` but `vite.config.ts` does not, so only a
relative path resolves in the client bundle.

`TagMenu` is modelled on `EmojiMenuExtension`, which is the same shape with a
`:` trigger. If upstream reworks the suggestion system, that file is the
reference to re-derive from.

### Why the input rule is overridden

`Suggestion`'s base input rule only opens the menu when the whole regex match
is two characters or fewer:

```js
if (match[0].length <= 2) {
  this.state.open = true;
}
```

That guard means "open on the bare trigger, don't re-open as the user keeps
typing", which suits `:` and `@` where the search term is optional. With
`requireSearchTerm: true` the term is mandatory, so the shortest match
mid-sentence is ` #w` — three characters, including the leading space the
pattern requires. The menu would only ever open at the very start of a line.

`TagMenuExtension` therefore overrides `inputRules` to open whenever the pattern
matches at all. The alternative, `requireSearchTerm: false`, would make a bare
`#` open the menu and flicker it on every markdown heading.

The same `<= 2` guard exists in `SuggestionsMenuPlugin.handleKeyDown`, but that
path is a fallback that only refreshes the query — it never closes the menu, so
leaving it alone is harmless.

## Testing

```bash
yarn test plugins/tags
```

Against a running instance:

1. Create a document titled **Tag vocabulary** containing `#wp1` and `#wp2`.
2. In another document, type `#w` — the menu should offer both. Pick one; it
   should insert `#wp1 ` as plain text.
3. Type `#wp9` by hand.
4. Open **Settings → Workspace → Tags**. `#wp1` should be under Approved,
   `#wp9` under *Not in the vocabulary* in red.
5. Add `#wp9` to the vocabulary document, click **reload**, and it should move
   to Approved.
6. Type `# ` at the start of a line — the menu must not open, and it should
   still become a heading.
