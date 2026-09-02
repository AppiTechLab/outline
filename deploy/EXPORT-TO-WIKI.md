# Nightly export to a GitLab wiki

Mirrors every Outline collection into a GitLab wiki repository each night, as
plain markdown, versioned in git.

Two equivalent scripts: **`export-to-gitlab-wiki.ps1`** for Windows (needs only
git) and **`export-to-gitlab-wiki.sh`** for the server (needs `jq`, `unzip`,
`rsync`).

## What this is and isn't

**It is a portability copy.** If this VM disappears, the content is still
readable — in GitLab, in markdown, with a commit history showing how it changed.
No Outline required.

**It is not a backup.** It cannot be restored into Outline, and it drops
comments, revision history, permissions, drafts and document relationships. The
`pg_dump` cron is the backup; this is insurance against the *format*, not the
disk.

Both are worth having, for different failures.

## What you need

A GitLab project whose wiki you're willing to overwrite — the script rsyncs
with `--delete`, so it owns that repo entirely. Don't point it at a wiki anyone
edits by hand.

Enable the wiki under **Project → Settings → General → Visibility → Wiki**, then
create one page in the UI so the repo exists. GitLab doesn't create
`<project>.wiki.git` until the wiki has content.

You'll need:

| | |
| --- | --- |
| `OUTLINE_URL` | `https://wiki.appitech.hevs.ch` |
| `OUTLINE_API_TOKEN` | An Outline API key from an **admin** account |
| `WIKI_REPO` | Push URL for the wiki repo, with credentials |

For `WIKI_REPO`, use a **project access token** with `write_repository` scope,
scoped to the wiki project only:

```
https://oauth2:<token>@gitlab.com/appitech/internal/labmirror.wiki.git
```

Not your personal token — this one sits in a file on the server and only needs
to write one repo.

## Running it from Windows

`export-to-gitlab-wiki.ps1` is the same thing in PowerShell, needing only git —
the bash version wants `jq`, `unzip` and `rsync`, which Windows doesn't have.

```powershell
$env:OUTLINE_URL        = "https://wiki.appitech.hevs.ch"
$env:OUTLINE_API_TOKEN  = "ol_api_..."
$env:OUTLINE_WIKI_REPO  = "https://oauth2:glpat-...@gitlab.com/appitech/internal/labmirror.wiki.git"

D:\Projects\outline\deploy\export-to-gitlab-wiki.ps1
```

Run it by hand once before scheduling.

### Scheduling it

Task Scheduler → **Create Task** (not Basic Task, which can't run when logged
out):

- **General** → *Run whether user is logged on or not*
- **Triggers** → Daily, 02:30
- **Actions** → Start a program:
  - Program: `powershell.exe`
  - Arguments:
    `-NoProfile -ExecutionPolicy Bypass -File "D:\Projects\outline\deploy\export-to-gitlab-wiki.ps1"`
- **Conditions** → untick *Start the task only if the computer is on AC power*
  if it's a laptop, and tick *Wake the computer to run this task*

Put the three values in the task's environment, or edit the script's `param`
defaults — **don't** put a token in the Arguments field, which is readable by
anyone who can see the task.

### The trade-off

A laptop is not a server. It'll miss nights when the machine is off, asleep, or
on a network that can't reach the VM — and it'll fail silently when it does.

That's tolerable here, because the mirror's job is to exist if the VM dies, not
to be current to the hour. A copy that's four days old still contains almost
everything. But check the wiki's commit history occasionally rather than
assuming; if the gaps get long, move it to the server's cron.

## Install (on the server)

```bash
sudo mkdir -p /srv/data/outline/wiki-export
sudo chown $USER:$USER /srv/data/outline/wiki-export

cp /opt/apps/outline/deploy/export-to-gitlab-wiki.sh /opt/apps/outline/deploy/
chmod +x /opt/apps/outline/deploy/export-to-gitlab-wiki.sh

sudo apt install -y jq unzip rsync   # curl and git are already present
```

Put the configuration somewhere only you can read:

```bash
cat > ~/.outline-export.env <<'EOF'
OUTLINE_URL=https://wiki.appitech.hevs.ch
OUTLINE_API_TOKEN=ol_api_...
WIKI_REPO=https://oauth2:glpat-...@gitlab.com/appitech/internal/labmirror.wiki.git
EOF
chmod 600 ~/.outline-export.env
```

Run it once by hand before scheduling it:

```bash
set -a; source ~/.outline-export.env; set +a
/opt/apps/outline/deploy/export-to-gitlab-wiki.sh
```

## Schedule

```cron
30 2 * * *  set -a; . $HOME/.outline-export.env; set +a; /opt/apps/outline/deploy/export-to-gitlab-wiki.sh >> /var/log/outline-export.log 2>&1
```

02:30, half an hour after the `pg_dump` at 03:00 — deliberately not at the same
time, since both read heavily.

`collections.export_all` is rate limited to **five per hour**, so nightly is
fine but don't build a retry loop around it.

## Options

| Variable | Default | |
| --- | --- | --- |
| `INCLUDE_PRIVATE` | `true` | Export private collections too. Set `false` if the wiki repo is readable by more people than the Outline workspace. |
| `INCLUDE_ATTACHMENTS` | `false` | Inline images only by default, since real files live in SharePoint. Setting `true` makes the repo grow without bound. |
| `WORK_DIR` | `/srv/data/outline/wiki-export` | Scratch space |

**Check `INCLUDE_PRIVATE` against who can read that GitLab project.** It
defaults to a complete mirror, which means *Lab management* — personnel,
finances — ends up in the wiki repo. That's correct for a private mirror and
badly wrong for an internal-visibility project.

## What the export looks like

One directory per collection, one `.md` per document, nested to match the
document tree. Titles become filenames.

**Internal links are rewritten for you.** `ExportDocumentTreeTask` matches every
`/doc/<slug>-<urlId>` against the documents being exported and replaces it with
a relative path to that `.md` file in the archive — `../Projects/Kickoff.md`
rather than a dead `/doc/` URL. Attachment references get the same treatment.

So the mirror is a navigable markdown tree, not just readable text.

The caveat: those paths are relative to the **archive layout**. GitLab wikis
address pages by name rather than file path, so links may resolve when browsing
the repo as files and not when browsing it as a rendered wiki. Check this on
your first run — it decides whether the mirror is genuinely browsable or only
archival.

**SharePoint links keep working** regardless — the payoff for the attachment
convention. Absolute external URLs don't care where the markdown lives.

## Safety behaviour

The script refuses to commit rather than pushing something wrong:

- Downloaded file isn't a valid zip → stop
- Export contains no markdown files → stop
- Nothing changed since last run → exit cleanly, no empty commit

If it fails, nothing is pushed and yesterday's mirror stands.

## Checking it works

```bash
tail -50 /var/log/outline-export.log
```

A good run ends with `Pushed:` and a diffstat. Then look at the wiki in GitLab —
the commit history is the real signal, since a mirror that stopped updating
looks identical to one that's up to date.

Worth setting a reminder to check it monthly. Silent backup failure is the
normal kind.
