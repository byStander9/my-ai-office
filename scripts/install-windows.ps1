[CmdletBinding()]
param(
    [switch]$SkipStart
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$codexOfficeDir = Join-Path $env:USERPROFILE ".codex\ai-office"
$sinkSource = Join-Path $projectRoot "codex\event_sink.py"
$sinkTarget = Join-Path $codexOfficeDir "event_sink.py"
$vbsPath = Join-Path $projectRoot "server\start-dashboard-hidden.vbs"
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "My AI Office Dashboard.lnk"
$wscriptPath = Join-Path $env:WINDIR "System32\wscript.exe"

foreach ($command in @("node", "npm", "py")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command '$command' was not found in PATH."
    }
}

Push-Location $projectRoot
try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "npm test failed." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $codexOfficeDir -Force | Out-Null
Copy-Item -LiteralPath $sinkSource -Destination $sinkTarget -Force
& node (Join-Path $projectRoot "scripts\configure-codex-hooks.mjs") install
if ($LASTEXITCODE -ne 0) { throw "Codex hook installation failed." }

$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscriptPath
$shortcut.Arguments = "//B //NoLogo `"$vbsPath`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "Start My AI Office in the background at Windows sign-in."
$shortcut.Save()

if (-not $SkipStart) {
    Start-Process -FilePath $wscriptPath -ArgumentList @("//B", "//NoLogo", "`"$vbsPath`"") -WindowStyle Hidden
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:4175/api/events" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ne 200) { throw "Unexpected HTTP status $($response.StatusCode)." }
    } catch {
        throw "The background process was installed, but the health check failed. Run 'npm run office' to diagnose."
    }
}

Write-Host "My AI Office is installed."
Write-Host "Dashboard: http://127.0.0.1:4175/"
Write-Host "Next: open Codex, run /hooks, review the user hooks, and trust them."
