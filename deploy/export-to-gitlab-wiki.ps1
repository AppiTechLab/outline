<#
.SYNOPSIS
    Exports every Outline collection and pushes it to a GitLab wiki repository.

.DESCRIPTION
    Triggers collections.export_all, waits for the job, downloads the markdown
    zip, and commits the result to a GitLab wiki repo. The wiki then holds a
    plain-markdown mirror of the whole workspace, versioned, somewhere entirely
    separate from the server.

    This is a portability copy, not a backup. It cannot be restored into
    Outline, and it drops comments, revision history, permissions and drafts.
    The pg_dump on the server is the backup; this is insurance against the
    format and the host.

    Needs only git and PowerShell 5.1+.

.PARAMETER OutlineUrl
    e.g. https://wiki.appitech.hevs.ch — falls back to $env:OUTLINE_URL.

.PARAMETER Token
    Outline API key from an ADMIN account. Falls back to
    $env:OUTLINE_API_TOKEN.

.PARAMETER WikiRepo
    Push URL for the wiki repo including credentials, e.g.
    https://oauth2:glpat-xxx@gitlab.com/group/project.wiki.git
    Falls back to $env:OUTLINE_WIKI_REPO.

.PARAMETER WorkDir
    Scratch space. Defaults to %LOCALAPPDATA%\outline-export.

.PARAMETER IncludePrivate
    Export private collections too. Default true — a complete mirror. Set false
    if the GitLab project is readable by more people than the Outline workspace.

.PARAMETER IncludeAttachments
    Default false: real files live in SharePoint, so only inline images travel.

.EXAMPLE
    .\export-to-gitlab-wiki.ps1
#>

[CmdletBinding()]
param(
    [string]$OutlineUrl = $env:OUTLINE_URL,
    [string]$Token      = $env:OUTLINE_API_TOKEN,
    [string]$WikiRepo   = $env:OUTLINE_WIKI_REPO,
    [string]$WorkDir    = (Join-Path $env:LOCALAPPDATA "outline-export"),
    [bool]$IncludePrivate     = $true,
    [bool]$IncludeAttachments = $false,
    [int]$PollSeconds = 10,
    [int]$PollMax     = 180      # 30 minutes
)

$ErrorActionPreference = 'Stop'

function Write-Log { param([string]$Message) Write-Host "$(Get-Date -Format s)  $Message" }
function Die { param([string]$Message) Write-Log "ERROR: $Message"; exit 1 }

foreach ($pair in @(
    @{ Name = 'OutlineUrl'; Value = $OutlineUrl },
    @{ Name = 'Token';      Value = $Token },
    @{ Name = 'WikiRepo';   Value = $WikiRepo })) {
    if (-not $pair.Value) { Die "$($pair.Name) not set. See EXPORT-TO-WIKI.md." }
}

$OutlineUrl = $OutlineUrl.TrimEnd('/')
$headers = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Die "git is not on PATH."
}

function Invoke-Outline {
    param([string]$Endpoint, [hashtable]$Body = @{})
    try {
        return Invoke-RestMethod -Uri "$OutlineUrl/api/$Endpoint" -Method Post `
            -Headers $headers -Body ($Body | ConvertTo-Json -Compress)
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 401) { Die "Rejected (401) — token wrong or expired." }
        if ($code -eq 403) { Die "Forbidden (403) — export_all needs an admin token." }
        if ($code -eq 429) { Die "Rate limited (429) — export_all allows five per hour." }
        Die "$Endpoint failed: $_"
    }
}

# ── 1. Trigger ───────────────────────────────────────────────────────────────

Write-Log "Requesting export (private=$IncludePrivate, attachments=$IncludeAttachments)"

$response = Invoke-Outline 'collections.export_all' @{
    format             = 'outline-markdown'
    includeAttachments = $IncludeAttachments
    includePrivate     = $IncludePrivate
}

$operationId = $response.data.fileOperation.id
if (-not $operationId) { Die "No fileOperation id returned." }
Write-Log "Export job $operationId created"

# ── 2. Wait ──────────────────────────────────────────────────────────────────

$ready = $false
for ($i = 1; $i -le $PollMax; $i++) {
    $state = (Invoke-Outline 'fileOperations.info' @{ id = $operationId }).data.state

    switch ($state) {
        'complete'  { Write-Log "Export ready after $($i * $PollSeconds)s"; $ready = $true }
        'error'     { Die "Outline reported the export failed." }
        'expired'   { Die "Export expired before download." }
        { $_ -in 'creating', 'uploading' } { Start-Sleep -Seconds $PollSeconds }
        default     { Die "Unexpected state '$state'." }
    }
    if ($ready) { break }
}
if (-not $ready) { Die "Export did not complete within $($PollMax * $PollSeconds)s." }

# ── 3. Download and unpack ───────────────────────────────────────────────────

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$zipPath    = Join-Path $WorkDir 'export.zip'
$extractDir = Join-Path $WorkDir 'extracted'

Write-Log "Downloading"
try {
    Invoke-WebRequest -Uri "$OutlineUrl/api/fileOperations.redirect" -Method Post `
        -Headers $headers -Body (@{ id = $operationId } | ConvertTo-Json -Compress) `
        -OutFile $zipPath
} catch {
    Die "Download failed: $_"
}

# A truncated download or an error page would otherwise be committed as garbage.
if ((Get-Item $zipPath).Length -lt 1024) { Die "Downloaded file is implausibly small." }

if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
try {
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
} catch {
    Die "Downloaded file is not a valid zip."
}

$mdCount = (Get-ChildItem -Path $extractDir -Filter *.md -Recurse -File).Count
if ($mdCount -eq 0) { Die "Export contained no markdown files — refusing to commit." }
Write-Log "Extracted $mdCount markdown files"

# ── 4. Sync into the wiki repo ───────────────────────────────────────────────

$repoDir = Join-Path $WorkDir 'wiki'

if (Test-Path (Join-Path $repoDir '.git')) {
    git -C $repoDir fetch --quiet origin
    git -C $repoDir reset --quiet --hard origin/HEAD
} else {
    if (Test-Path $repoDir) { Remove-Item -Recurse -Force $repoDir }
    git clone --quiet $WikiRepo $repoDir
    if ($LASTEXITCODE -ne 0) { Die "git clone failed — check WikiRepo and its token." }
}

# Mirror semantics: clear everything except .git, then copy. Simpler and safer
# than trying to reproduce rsync --delete by hand.
Get-ChildItem -Path $repoDir -Force |
    Where-Object { $_.Name -ne '.git' } |
    Remove-Item -Recurse -Force

Copy-Item -Path (Join-Path $extractDir '*') -Destination $repoDir -Recurse -Force

# ── 5. Commit ────────────────────────────────────────────────────────────────

Push-Location $repoDir
try {
    git config user.email "outline-export@appitech.hevs.ch"
    git config user.name  "Outline export"

    if (-not (git status --porcelain)) {
        Write-Log "No changes since last run"
        return
    }

    git add -A
    git commit --quiet -m "Outline export $(Get-Date -Format yyyy-MM-dd)"
    git push --quiet origin HEAD
    if ($LASTEXITCODE -ne 0) { Die "git push failed." }

    Write-Log "Pushed $(git diff --shortstat HEAD~1 HEAD)"
} finally {
    Pop-Location
}
