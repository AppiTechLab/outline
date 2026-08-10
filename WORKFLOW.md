# How we use the wiki

This wiki is wired to GitLab. Tasks written here can become GitLab issues, and
closing an issue ticks the task back off here. This page explains the
conventions so it stays coherent.

Read the first two sections. The rest is reference.

---

## What goes where

| | Owns |
| --- | --- |
| **GitLab** | Issue state, who's doing it, what's in this sprint |
| **This wiki** | Why it exists, what we decided, the discussion around it |

GitLab is bad at context and we are bad at tracking. Don't fight either.

**Do not mirror the GitLab board here.** A page listing "current sprint" will be
wrong within a day. If you want live issue state, paste the issue link — it
renders with its real title and status.

---

## The loop

### 1. Capture, in whatever page you're already writing

Start from a template where one fits — **New document → from template**. The
meeting and experiment templates already contain the tag stubs, so you complete
them rather than recalling the syntax.

Meeting notes, a spec, a scratch page. Write checkboxes as things come up:

```markdown
- [ ] Draft the consent form #PM/gitlab/xr4inclusion #PM/assign/antoine [due:: 2026-08-20]
- [ ] Ask Marie whether the venue is booked
```

The second stays a personal note. **Only tagged tasks sync** — tag deliberately,
not everything.

### 2. Push, after the meeting

**Settings → Workspace → GitLab Tasks → Push.** Hit **Preview** first to see
what it would create.

Each tagged task becomes a GitLab issue and the line is stamped:

```markdown
- [ ] Draft the consent form #PM/gitlab/xr4inclusion #synced [GL-#42](https://gitlab.com/…/issues/42)
```

That link renders as a live chip — hover it to see the issue's current title and
state. The meeting note stops being a snapshot.

### 3. Pull, each morning

Same page, **Pull**. Anything closed in GitLab ticks its checkbox here, so your
notes stay true without you maintaining them.

> **Once a task is stamped, GitLab owns it.** Editing the task text afterwards
> does *not* update the issue — they silently diverge. If the scope changes,
> close the issue and write a new task.

---

## Task syntax

Any checkbox is a task. Metadata goes in `[key:: value]`:

```markdown
- [ ] Book the venue [due:: 2026-09-01] [priority:: high] #events
```

| Field | Meaning |
| --- | --- |
| `[due:: YYYY-MM-DD]` | When it must be done. Also sets the GitLab issue due date. |
| `[scheduled:: …]` | When you plan to start |
| `[priority:: …]` | `low`, `medium`, `high`, `highest` |
| `[done:: …]` | When it was finished |

Dates are `YYYY-MM-DD`, or `today` / `tomorrow`.

**No emoji.** `📅 2026-08-20` is not read — use `[due:: 2026-08-20]`. If you
paste something from Obsidian, the emoji will show up in the GitLab issue title,
which is your sign it didn't parse.

### GitLab routing tags

| Tag | Effect |
| --- | --- |
| `#PM/gitlab/<repo>` | **Required to sync.** Routes the issue to that project. |
| `#PM/assign/<username>` | Assigns the issue. Repeatable. |
| `#synced` | Added automatically. Don't write it by hand. |

---

## Finding things

### Task queries

Put a code block in any page and set its language to **Tasks query** from the
dropdown (typing ```` ```tasks ```` does not set it):

```
not done
due before today
sort by priority
```

That searches every document you can read. A personal dashboard page with this
block is the intended use.

> Run a **pull** before trusting a dashboard, or issues closed in GitLab still
> show as open here.

Other filters: `done`, `no due date`, `priority above medium`,
`tag includes work`, `path includes Engineering`, `limit 20`. A typo shows a red
explanation rather than silently returning nothing.

Tag filters roll up, so a task tagged `#PM/project/Gate` is found by all three:

```
tag includes PM/project/Gate
tag includes PM/project
tag includes PM
```

Useful for a per-project dashboard — `tag includes PM/project/Gate` plus
`not done` gives you everything open on that project across every page.

Every filter, with worked examples, is in `plugins/tasks/FILTERS.md`. Worth
pasting into the wiki next to this page.

### Tags

Type `#` and pick from the list. The vocabulary is the
[Tag vocabulary](/search?query=Tag%20vocabulary) page — every `#tag` written
there is approved.

Tags are clickable. Clicking one opens a page listing **every line** that
mentions it across the wiki, and clicking a line jumps to that exact spot in the
source document. The sidebar has the full tree.

Nested tags roll up: `#PM/project/xr4inclusion` also counts as `#PM/project` and
`#PM`, so clicking the parent finds everything beneath it.

**If your tag shows in red**, it isn't in the vocabulary — usually a typo.
Either fix it or add it to the vocabulary page. Settings → Workspace → Tags
lists every off-vocabulary tag in use.

### Searching for a tag

Outline's search box needs **quotes** for tags:

```
"#PM/project/xr4inclusion"
```

Without quotes the `#` is stripped and you match the plain word instead.

---

## Conventions worth keeping

**Tag pages, not tag sprawl.** Add to the vocabulary deliberately. It's a shared
page with revision history — if you're unsure, ask rather than inventing a
synonym. `#needs-analysis` and `#needsanalysis` are two tags to a computer.

**One task, one line.** The sync matches on the exact line text, so a task split
across lines won't sync.

**Don't tag speculative work.** An issue created and immediately closed is worse
than a note that never became one.

---

## Known rough edges

Honest list, so nobody wastes time on these:

- **Syncs are manual.** Nothing happens on a schedule — an admin runs push and
  pull from **Settings → Workspace → GitLab Tasks**. Deliberate rather than
  accidental, but it means the two sides drift between runs.
- **Push never updates an existing issue.** Covered above, but it's the mistake
  people make.
- **Pull only closes, never reopens.** Reopening an issue in GitLab does not
  untick the task.
- **Two identical unsynced task lines in one document** both resolve to the
  first when stamping. Rare, but vary the wording if you notice it.
- **Duplicate tag counts differ per person**, because they're computed over the
  documents you can read. Two people can legitimately see different numbers.

---

## Where the pieces live

For whoever maintains this:

| | |
| --- | --- |
| `plugins/tasks` | Task parsing and ```` ```tasks ```` query blocks |
| `plugins/tags` | Tag vocabulary, `#` autocomplete, tag pages, sidebar |
| `plugins/gitlab-tasks` | Push and pull against the GitLab API |
| bundled `plugins/gitlab` | Link unfurling for pasted GitLab URLs |

Each has a `README.md`. `plugins/tags/PROPOSAL.md` records why this stops where
it does and lists the core files patched — read it before adding more.
