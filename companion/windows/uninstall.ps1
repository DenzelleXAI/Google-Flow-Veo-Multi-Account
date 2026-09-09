$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This uninstaller is intended for Windows."
}

$appDir = Join-Path $env:LOCALAPPDATA "PersistentAIVideoStudio"
$startupDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$startupCmd = Join-Path $startupDir "Persistent AI Video Studio Companion.cmd"
$configPath = Join-Path $appDir "companion.json"

$mediaRoot = $null
if (Test-Path $configPath) {
  try {
    $config = Get-Content -Raw $configPath | ConvertFrom-Json
    $mediaRoot = [string]$config.mediaRoot
  } catch {}
}

if (Test-Path $startupCmd) {
  Remove-Item -Force $startupCmd
}

# Stop only the installed companion copy. Do not terminate unrelated Node.js processes.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $appDir "companion.mjs")) } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

if (Test-Path $appDir) {
  Remove-Item -Recurse -Force $appDir
}

Write-Host "Windows companion uninstalled."
if ($mediaRoot) {
  Write-Host "Media was NOT deleted: $mediaRoot"
} else {
  Write-Host "Your media folder was not touched."
}
