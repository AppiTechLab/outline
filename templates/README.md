# Templates

Starting points for the page types a lab writes most. Each has the tag
conventions already embedded, so nobody has to remember the syntax — completing
a stub is easier than recalling `#PM/gitlab/<repo>` from memory.

| Template | For |
| --- | --- |
| `weekly-meeting.md` | The recurring group meeting. Carries its own actions forward. |
| `meeting-minutes.md` | One-off or ad-hoc meetings |
| `experiment-log.md` | A single experiment or run |

## Installing them

Templates live in Outline, not in this repo. To add one:

1. **Settings → Templates → New template**
2. Pick the collection it belongs to (or leave it workspace-wide)
3. Paste the file's contents

Pasting markdown works — Outline parses it, so headings, tables and checkboxes
arrive intact. The italic *hint text* is meant to be overwritten; it's plain
italics rather than Outline's placeholder marks, which can't survive a paste.

Then: **New document → from template**.

## Why bother

At two people, conventions live in your head. At ten they don't, and a tag
scheme that isn't in a template decays within a month — `#PM/gitlab/repo`
becomes `#gitlab/repo` becomes nothing, and the sync quietly stops covering
half the lab's work.

Templates also make search work. Fixed headings mean `text includes Deviations`
finds every experiment that recorded one, across everybody's pages.

They cost nothing on upgrade — they're documents, not code.

## A note on the weekly template

It opens with two **Tasks query** blocks rather than a "carried over from last
week" heading. Those fill themselves in from every page in the wiki, so nobody
copies actions forward and nothing is lost when someone forgets.

Two consequences worth understanding before you adapt it:

- **Run a GitLab pull before the meeting**, or work already closed still shows
  as open. Making that the chair's job is the simplest fix.
- **An action with no `[due::]` never appears in those blocks.** That's the one
  way a task can drop out of the weekly cycle entirely, which is why the
  template says so twice.

The blocks need their language set to *Tasks query* from the dropdown after
pasting — markdown can't carry that attribute.

## Adapting them

Edit freely, but keep these:

- **The `#PM/gitlab/<repo>` stub in the Actions section.** It's the only thing
  that makes a task sync. An action without it is invisible to GitLab.
- **A deliberately untagged example.** People need to see that not every
  checkbox becomes an issue, or they tag everything.
- **`[due:: YYYY-MM-DD]` rather than a date emoji.** Emoji dates aren't parsed.

Add a `#PM/project/<name>` tag near the top of each template you specialise per
project — that's what makes `/tags/pm/project/<name>` a useful index of
everything touching it.

## Worth adding later

Same pattern, when you need them:

- **Onboarding** — a checklist ending in "read the workflow page"
- **Protocol** — the stable procedure an experiment log links to
- **Deliverable draft** — matching your WP and reporting structure
- **Weekly report** — often just a ```` ```tasks ```` block plus a paragraph

For that last one, a query block does most of the work:

```
done
done on or after YYYY-MM-DD
sort by done reverse
```
