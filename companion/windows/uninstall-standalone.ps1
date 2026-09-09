$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This uninstaller is intended for Windows."
}

$appDir = Join-Path $env:LOCALAPPDATA "PersistentAIVideoStudio"
$startupDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$startupCmd = Join-Path $startupDir "Persistent AI Video Studio Companion.cmd"
$configPath = Join-Path $appDir "companion.json"
$exePath = Join-Path $appDir "PersistentAIVideoStudioCompanion.exe"

$mediaRoot = $null
if (Test-Path $configPath) {
  try {
    $config = Get-Content -Raw $configPath | ConvertFrom-Json
    $mediaRoot = [string]$config.mediaRoot
    if (-not [string]::IsNullOrWhiteSpace([string]$config.executablePath)) {
      $exePath = [string]$config.executablePath
    }
  } catch {}
}

if (Test-Path $startupCmd) {
  Remove-Item -Force $startupCmd
}

# Stop only the executable installed by this package.
Get-CimInstance Win32_Process -Filter "Name = 'PersistentAIVideoStudioCompanion.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($exePath)) } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

if (Test-Path $appDir) {
  Remove-Item -Recurse -Force $appDir
}

Write-Host "Standalone Windows companion uninstalled."
if ($mediaRoot) {
  Write-Host "Media was NOT deleted: $mediaRoot"
} else {
  Write-Host "Your media folder was not touched."
}
