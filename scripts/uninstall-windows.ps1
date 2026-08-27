[CmdletBinding()]
param(
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot "server\office-server.mjs"
$vbsPath = Join-Path $projectRoot "server\start-dashboard-hidden.vbs"
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "My AI Office Dashboard.lnk"
$codexOfficeDir = Join-Path $env:USERPROFILE ".codex\ai-office"

if (Get-Command node -ErrorAction SilentlyContinue) {
    & node (Join-Path $projectRoot "scripts\configure-codex-hooks.mjs") remove
    if ($LASTEXITCODE -ne 0) { throw "Codex hook removal failed." }
}

if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
}

$targets = Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -ieq "node.exe" -and $_.CommandLine -like "*$serverPath*") -or
    ($_.Name -ieq "wscript.exe" -and $_.CommandLine -like "*$vbsPath*")
}
foreach ($target in $targets) {
    Invoke-CimMethod -InputObject $target -MethodName Terminate | Out-Null
}

$sinkTarget = Join-Path $codexOfficeDir "event_sink.py"
if (Test-Path -LiteralPath $sinkTarget) {
    Remove-Item -LiteralPath $sinkTarget -Force
}

if ($RemoveData -and (Test-Path -LiteralPath $codexOfficeDir)) {
    $resolvedOfficeDir = (Resolve-Path -LiteralPath $codexOfficeDir).Path
    $expectedOfficeDir = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".codex\ai-office"))
    if ($resolvedOfficeDir -ne $expectedOfficeDir) { throw "Refusing to remove an unexpected data directory." }
    Remove-Item -LiteralPath $resolvedOfficeDir -Recurse -Force
}

Write-Host "My AI Office autostart and hooks were removed."
if (-not $RemoveData) {
    Write-Host "Event data was preserved in $codexOfficeDir. Use -RemoveData to delete it."
}
