<#
.SYNOPSIS
    Runs the Outline <-> GitLab task sync.

.DESCRIPTION
    Thin wrapper over the plugins/gitlab-tasks API so a sync is one command
    rather than a hand-built REST call.

    Push  creates GitLab issues for tasks tagged #PM/gitlab/<repo> that don't
          have one yet, then stamps each task with a link to its issue.
    Pull  ticks tasks whose linked issue has since been closed.

    Neither is destructive to GitLab: push only creates, pull only reads.
    Push does edit your documents, which is what -DryRun is for.

.PARAMETER Action
    status, push or pull. Defaults to status.

.PARAMETER DryRun
    Report what would happen without calling GitLab or editing documents.

.PARAMETER DocumentId
    Limit the sync to a single document instead of the whole workspace.

.PARAMETER Token
    Outline API key. Falls back to $env:OUTLINE_API_TOKEN.
    Create one at Settings -> API and Access; it starts with "ol_api_".

.PARAMETER BaseUrl
    Outline base URL. Falls back to $env:OUTLINE_URL, then localhost:3000.

.EXAMPLE
    .\gitlab-sync.ps1 status

.EXAMPLE
    .\gitlab-sync.ps1 push -DryRun

.EXAMPLE
    .\gitlab-sync.ps1 pull
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'push', 'pull')]
    [string]$Action = 'status',

    [switch]$DryRun,
    [string]$DocumentId,
    [string]$Token = $env:OUTLINE_API_TOKEN,
    [string]$BaseUrl
)

$ErrorActionPreference = 'Stop'

if (-not $BaseUrl) {
    $BaseUrl = if ($env:OUTLINE_URL) { $env:OUTLINE_URL } else { 'http://localhost:3000' }
}
$BaseUrl = $BaseUrl.TrimEnd('/')

if (-not $Token) {
    Write-Error @'
No API token. Either pass -Token, or set it for this session:

    $env:OUTLINE_API_TOKEN = "ol_api_..."

Create one in Outline at Settings -> API and Access -> New API key.
'@
}

$headers = @{
    Authorization  = "Bearer $Token"
    'Content-Type' = 'application/json'
}

function Invoke-Sync {
    param([string]$Endpoint, [hashtable]$Body)

    try {
        return Invoke-RestMethod -Uri "$BaseUrl/api/$Endpoint" -Method Post `
            -Headers $headers -Body ($Body | ConvertTo-Json -Compress)
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        switch ($status) {
            401 { Write-Error "Rejected (401). The API token is wrong or expired." }
            404 { Write-Error "No such endpoint (404). The gitlab-tasks plugin isn't loaded — check GITLAB_TASKS_URL and GITLAB_TASKS_TOKEN are set, and that you've rebuilt." }
            default { Write-Error "Request to $Endpoint failed: $_" }
        }
    }
}

if ($Action -eq 'status') {
    $res = Invoke-Sync 'gitlabTasks.status' @{}
    $d = $res.data

    if (-not $d.configured) {
        Write-Host "Not configured." -ForegroundColor Yellow
        Write-Host "Set GITLAB_TASKS_URL and GITLAB_TASKS_TOKEN in .env, then rebuild."
        return
    }

    Write-Host "GitLab   : $($d.url)"
    Write-Host "Tag prefix: #$($d.tagPrefix)/gitlab/<repo>"
    Write-Host "Synced tag: $($d.syncedTag)"
    if ($d.fallbackProject) { Write-Host "Fallback : $($d.fallbackProject)" }

    if ($d.error) {
        Write-Host "Token    : FAILED — $($d.error)" -ForegroundColor Red
    } else {
        Write-Host "Token    : ok, acting as $($d.account)" -ForegroundColor Green
    }
    return
}

$body = @{ dryRun = [bool]$DryRun }
if ($DocumentId) { $body.documentId = $DocumentId }

$res = Invoke-Sync "gitlabTasks.$Action" $body
$results = @($res.data.results)

if ($DryRun) {
    Write-Host "DRY RUN — nothing was created or changed." -ForegroundColor Yellow
}

if ($results.Count -eq 0) {
    Write-Host "Nothing to do."
    return
}

# Group so a large sweep reads as a summary rather than a wall of lines.
foreach ($group in $results | Group-Object status | Sort-Object Name) {
    $colour = switch ($group.Name) {
        'created'   { 'Green' }
        'completed' { 'Green' }
        'failed'    { 'Red' }
        default     { 'DarkGray' }
    }

    Write-Host ''
    Write-Host "$($group.Name) ($($group.Count))" -ForegroundColor $colour

    foreach ($item in $group.Group) {
        $line = "  $($item.title)"
        if ($item.issueIid) { $line += "  [GL-#$($item.issueIid)]" }
        if ($item.detail)   { $line += "  — $($item.detail)" }
        Write-Host $line
        Write-Host "      in $($item.documentTitle)" -ForegroundColor DarkGray
    }
}

Write-Host ''
$failed = ($results | Where-Object status -eq 'failed').Count
if ($failed -gt 0) {
    Write-Host "$failed failed. One failure never aborts the run — rerun after fixing." -ForegroundColor Red
}
