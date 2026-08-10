# Task query reference

Everything the ```` ```tasks ```` block understands.

To create one: insert a code block and set its language to **Tasks query** from
the dropdown. Typing ```` ```tasks ```` does *not* set it — `CodeFence`'s input
rule matches bare backticks only. Pasting markdown that contains a
```` ```tasks ```` fence does work.

```
not done
due before today
sort by priority
limit 20
```

**Every filter is ANDed.** There is no `or` and no grouping. Blank lines and
lines starting with `#` are ignored. An unrecognised line shows a red
explanation above the results rather than returning nothing silently.

---

## Status

| Filter | Matches |
| --- | --- |
| `done` | Ticked tasks |
| `not done` | Unticked tasks |
| `open` | Same as `not done` |

---

## Dates

Any of these fields: **`due`**, **`scheduled`**, **`start`**, **`created`**,
**`done`**, **`cancelled`**.

| Filter | Matches |
| --- | --- |
| `due before 2026-09-01` | Strictly earlier |
| `due after today` | Strictly later |
| `due on 2026-08-20` | That exact day |
| `due on or before today` | Earlier or same day |
| `due on or after 2026-01-01` | Later or same day |
| `no due date` | Tasks with no `[due:: …]` at all |
| `has scheduled date` | Tasks that have one |

Values are `YYYY-MM-DD`, or the keywords `today`, `tomorrow`, `yesterday`,
resolved in **local time** when the query is parsed — a task due "today" flips
over at your midnight, not UTC's.

A task with no date never satisfies a date comparison. Use `no due date` to find
those.

There is no date arithmetic: `due before today + 7` is not supported, write the
date.

### Writing dates on a task

```markdown
- [ ] Book the venue [due:: 2026-09-01] [scheduled:: 2026-08-25]
```

Emoji dates (`📅 2026-09-01`) are **not** read.

---

## Priority

| Filter | Matches |
| --- | --- |
| `priority is high` | Exactly that level |
| `priority is not none` | Any level except that one |
| `priority above medium` | More urgent than |
| `priority below high` | Less urgent than |

Levels, least to most urgent:

```
none  lowest  low  medium  high  highest
```

Accepted aliases: `med` and `normal` for `medium`, `urgent` for `highest`.

Written on a task as `[priority:: high]`. Tasks with no priority count as
`none`.

---

## Tags

| Filter | Matches |
| --- | --- |
| `tag includes work` | Tasks tagged `#work` |
| `tag does not include archive` | Everything else |
| `tags includes work` | Same — `tag` and `tags` both work |

The leading `#` is optional and matching is case-insensitive, so these are
identical:

```
tag includes PM/project
tag includes #PM/project
tag includes pm/project
```

**Nested tags roll up.** A task tagged `#PM/project/Gate` is found by all of:

```
tag includes PM/project/Gate
tag includes PM/project
tag includes PM
```

Only whole segments count — `tag includes PM/pro` matches nothing, so
`#PM/project` and `#PM/prototype` never collide.

Negation covers descendants too: `tag does not include PM/project` excludes
`#PM/project/Gate`.

---

## Text and location

| Filter | Matches |
| --- | --- |
| `text includes review` | Task text contains it |
| `text does not include draft` | It doesn't |
| `description includes review` | Same as `text` |
| `path includes Engineering` | Collection name or document title contains it |
| `path does not include Archive` | It doesn't |

Both are case-insensitive substring matches. `text` searches the task's display
text — tags are included, but `[key:: value]` fields have been stripped.

---

## Sorting

```
sort by due
sort by priority reverse
```

| Key | Order |
| --- | --- |
| `due` `scheduled` `start` `created` `done` | Earliest first |
| `priority` | Most urgent first |
| `text` | Alphabetical |
| `path` | Alphabetical by collection then document |

Several `sort by` lines apply in order — the first is the primary sort.

**Tasks missing the sorted date always sort last**, in either direction. An
undated task is not "earliest", and `reverse` doesn't promote it to the top.

---

## Output

| Line | Effect |
| --- | --- |
| `limit 20` | At most 20 results. `limit to 20` also works. |
| `hide path` | Don't show the source document. `hide document` also works. |
| `show path` | Show it (the default) |

The footer always reports the true total, so `limit 20` on 53 matches shows
"53 tasks, showing 20".

---

## Not supported

Worth knowing so you don't hunt for them:

- `or`, and any grouping or parentheses
- `group by`
- Date arithmetic (`today + 7`)
- Recurrence (`[repeat:: every week]` is parsed and displayed, but completing a
  task does not create the next one)
- Ticking a checkbox from the results — the list is read-only, tick it in the
  source document

---

## Worked examples

**Everything overdue, most urgent first**

```
not done
due before today
sort by priority
```

**A project dashboard**

```
not done
tag includes PM/project/Gate
sort by due
hide path
```

**This week's plan, ignoring what's already scheduled**

```
not done
due on or before 2026-08-14
no scheduled date
sort by due
```

**Unprioritised backlog, to triage**

```
not done
priority is none
no due date
limit 25
```

**What got finished recently**

```
done
done on or after 2026-08-01
sort by done reverse
```

**Someone else's work on a project**

```
not done
tag includes PM/assign/marie
tag includes PM/project/Gate
```

---

## If a query returns nothing

Strip it back to `not done` and add filters one line at a time.

- **`not done` alone returns nothing** — the tasks aren't being found. They must
  be checkbox items in documents you can read, not drafts, not archived.
- **A tag filter empties it** — check the tag is written with whitespace before
  the `#` and sits on the same line as the checkbox.
- **A date filter empties it** — remember tasks with no date never match a date
  comparison.

Results refresh about 600ms after you stop typing.
