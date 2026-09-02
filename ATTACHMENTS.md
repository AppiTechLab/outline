# Where files go

**Data and large files go in SharePoint. The wiki links to them.**

Only small images belong in a page.

---

## The rule

| | Where | Why |
| --- | --- | --- |
| Screenshots, plots, diagrams, figures | **In the page** — drag and drop | They're what makes a page readable, and they're small |
| Datasets, recordings, raw exports, large PDFs, archives | **SharePoint**, linked from the page | Too big for the server, and they must outlive the wiki |

The upload limit is set to 10 MB. That's generous for a figure and hopeless for
a dataset, which is deliberate — if an upload is refused, it belongs in
SharePoint.

---

## Why not just attach everything

**Attachments don't survive leaving Outline.** A file dragged into a page is
served from a URL like `/api/attachments.redirect?id=…`, which means nothing
outside this wiki. Export the content to markdown, or push it into a GitLab
wiki, and every one of those links is dead. A SharePoint URL is absolute and
keeps working wherever the text ends up.

That matters here because the wiki is on a *test*-tier VM and the content is
expected to move eventually.

**The server has 500 GB, shared with everything else on it.** SharePoint has
far more, is already backed up by the institution, and is where the lab's files
live anyway.

**Files in the wiki are hard to work with.** Nobody can open a dataset in
SharePoint's desktop sync, run a script against it, or share it with a partner
who has no wiki account.

---

## How to link

1. Put the file in the lab's **SharePoint library** — not personal OneDrive.
   Personal storage dies with the account, and every link into it breaks when
   someone leaves.
2. **Copy link**, and set the scope to **People in your organisation**. A
   "specific people" link breaks for everyone you didn't individually name.
3. Paste it into the page **with a descriptive label**.

```markdown
[Eye-tracking raw data, session 3](https://hessovs.sharepoint.com/…)
```

Not this:

```markdown
https://hessovs.sharepoint.com/:x:/r/sites/…/Doc.aspx?d=w4f2a1&csf=1&web=1&e=Xk9Qm2
```

SharePoint URLs are unreadable. If the link ever breaks, the label is the only
thing that tells you what it pointed at — and it's what someone searching the
wiki will actually match against.

---

## Naming files

Storage is flat, so **the filename carries everything the folder structure
would have**. Date, project, what it is:

```
2026-08-14-gate-eyetracking-session3.csv
2026-08-14-gate-eyetracking-session3-README.md
```

Not `data.csv`, `final_v2.xlsx`, `data (1).csv`.

This is the whole organisational scheme. A flat store works fine when the wiki
is the way in — but only if a file found on its own still explains itself.

A short `-README.md` beside anything non-obvious costs a minute and saves an
hour in two years.

---

## Participant and personal data

**Keep it in a separate, restricted folder.** Not because of tidiness — because
access restriction and scheduled deletion are commitments in the ethics
approval, and both are folder-shaped operations. Deleting "all participant data
from the 2026 study" out of a flat store means grepping filenames and hoping.

**Don't paste personal data into wiki pages at all.** Deleting the text is not
enough: the page keeps revision history, Trash keeps the document, and the
nightly `pg_dump` keeps both. If something sensitive does land in a page,
permanently delete the document rather than just editing it out, and tell
whoever handles data protection.

---

## Checklist

Before attaching anything, ask:

- **Is it over 10 MB?** SharePoint.
- **Is it data rather than an illustration?** SharePoint.
- **Would someone want it without the wiki?** SharePoint.
- **Does it identify a person?** Restricted SharePoint folder, and not in a
  page.

Otherwise, drag it in.
