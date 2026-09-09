$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This installer is intended for Windows."
}

$packageDir = $PSScriptRoot
$sourceExe = Join-Path $packageDir "PersistentAIVideoStudioCompanion.exe"
$sourceRunner = Join-Path $packageDir "run-standalone.ps1"
$sourceUninstaller = Join-Path $packageDir "uninstall-standalone.ps1"

foreach ($required in @($sourceExe, $sourceRunner, $sourceUninstaller)) {
  if (-not (Test-Path $required)) {
    throw "Required package file is missing: $required"
  }
}

$appDir = Join-Path $env:LOCALAPPDATA "PersistentAIVideoStudio"
$configPath = Join-Path $appDir "companion.json"
$runnerPath = Join-Path $appDir "run-companion.ps1"
$uninstallerPath = Join-Path $appDir "uninstall.ps1"
$exePath = Join-Path $appDir "PersistentAIVideoStudioCompanion.exe"
$logPath = Join-Path $appDir "companion.log"
$startupDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$startupCmd = Join-Path $startupDir "Persistent AI Video Studio Companion.cmd"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null

# Stop only the installed standalone companion before replacing it.
Get-CimInstance Win32_Process -Filter "Name = 'PersistentAIVideoStudioCompanion.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($exePath)) } |
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

Write-Host "Enter COMPANION_TOKEN. It will be protected by Windows DPAPI for this Windows user."
$tokenSecure = Read-Host "Companion token" -AsSecureString
$encryptedToken = ConvertFrom-SecureString $tokenSecure
if ([string]::IsNullOrWhiteSpace($encryptedToken)) {
  throw "Companion token cannot be empty."
}

Copy-Item -Force $sourceExe $exePath
Copy-Item -Force $sourceRunner $runnerPath
Copy-Item -Force $sourceUninstaller $uninstallerPath

$config = [ordered]@{
  appUrl = $appUrl
  deviceName = $deviceName
  mediaRoot = $mediaRoot
  encryptedToken = $encryptedToken
  executablePath = $exePath
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
Write-Host "Standalone Windows companion installed."
Write-Host "Executable: $exePath"
Write-Host "Config:     $configPath"
Write-Host "Startup:    $startupCmd"
Write-Host "Media:      $mediaRoot"
Write-Host "Log:        $logPath"
Write-Host ""
Write-Host "Starting one companion instance now..."
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", ('"' + $runnerPath + '"')
)
