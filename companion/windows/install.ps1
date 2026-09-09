$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This installer is intended for Windows."
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$sourceCompanion = Join-Path $projectRoot "companion\index.mjs"
if (-not (Test-Path $sourceCompanion)) {
  throw "Unable to find companion/index.mjs from $projectRoot"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js is required. Install Node.js 22+ and run this installer again."
}

$appDir = Join-Path $env:LOCALAPPDATA "PersistentAIVideoStudio"
$configPath = Join-Path $appDir "companion.json"
$runnerPath = Join-Path $appDir "run-companion.ps1"
$companionCopy = Join-Path $appDir "companion.mjs"
$logPath = Join-Path $appDir "companion.log"
$startupDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$startupCmd = Join-Path $startupDir "Persistent AI Video Studio Companion.cmd"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null

# Reinstall/update should never leave two companion loops running.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($companionCopy) } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

$defaultUrl = "http://localhost:3000"
$appUrl = Read-Host "App URL [$defaultUrl]"
if ([string]::IsNullOrWhiteSpace($appUrl)) { $appUrl = $defaultUrl }
$appUrl = $appUrl.TrimEnd("/")

$defaultDeviceName = $env:COMPUTERNAME
$deviceName = Read-Host "Device name [$defaultDeviceName]"
if ([string]::IsNullOrWhiteSpace($deviceName)) { $deviceName = $defaultDeviceName }

$defaultMediaRoot = "D:\AI Video Studio"
$mediaRoot = Read-Host "Media root [$defaultMediaRoot]"
if ([string]::IsNullOrWhiteSpace($mediaRoot)) { $mediaRoot = $defaultMediaRoot }

Write-Host "Enter COMPANION_TOKEN. It will be protected with Windows DPAPI for this Windows user."
$tokenSecure = Read-Host "Companion token" -AsSecureString
$encryptedToken = ConvertFrom-SecureString $tokenSecure
if ([string]::IsNullOrWhiteSpace($encryptedToken)) {
  throw "Companion token cannot be empty."
}

Copy-Item -Force $sourceCompanion $companionCopy
Copy-Item -Force (Join-Path $PSScriptRoot "run.ps1") $runnerPath

$config = [ordered]@{
  appUrl = $appUrl
  deviceName = $deviceName
  mediaRoot = $mediaRoot
  encryptedToken = $encryptedToken
  nodePath = $node.Source
  companionScript = $companionCopy
  logPath = $logPath
  installedAt = (Get-Date).ToString("o")
}

$config | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $configPath

$cmdContent = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$runnerPath"
"@
Set-Content -Encoding ASCII -Path $startupCmd -Value $cmdContent

Write-Host ""
Write-Host "Windows companion installed."
Write-Host "Config:  $configPath"
Write-Host "Startup: $startupCmd"
Write-Host "Media:   $mediaRoot"
Write-Host "Log:     $logPath"
Write-Host ""
Write-Host "Starting one companion instance now..."
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", ('"' + $runnerPath + '"')
)
