$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "This companion runner is intended for Windows."
}

$appDir = Join-Path $env:LOCALAPPDATA "PersistentAIVideoStudio"
$configPath = Join-Path $appDir "companion.json"

if (-not (Test-Path $configPath)) {
  throw "Companion config is missing. Re-run companion/windows/install.ps1."
}

$config = Get-Content -Raw $configPath | ConvertFrom-Json
$required = @("appUrl", "deviceName", "mediaRoot", "encryptedToken", "nodePath", "companionScript")
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([string]$config.$name)) {
    throw "Companion config is missing '$name'. Re-run the installer."
  }
}

if (-not (Test-Path $config.nodePath)) {
  throw "Configured Node.js executable does not exist: $($config.nodePath)"
}
if (-not (Test-Path $config.companionScript)) {
  throw "Installed companion script is missing: $($config.companionScript)"
}

$secureToken = ConvertTo-SecureString ([string]$config.encryptedToken)
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if ([string]::IsNullOrWhiteSpace($plainToken)) {
  throw "Unable to decrypt the companion token for this Windows user."
}

New-Item -ItemType Directory -Force -Path ([string]$config.mediaRoot) | Out-Null

$env:COMPANION_APP_URL = [string]$config.appUrl
$env:COMPANION_DEVICE_NAME = [string]$config.deviceName
$env:COMPANION_MEDIA_ROOT = [string]$config.mediaRoot
$env:COMPANION_TOKEN = $plainToken

$logPath = if ([string]::IsNullOrWhiteSpace([string]$config.logPath)) {
  Join-Path $appDir "companion.log"
} else {
  [string]$config.logPath
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Encoding UTF8 -Path $logPath -Value "[$timestamp] Starting companion for $($config.deviceName)"

try {
  & ([string]$config.nodePath) ([string]$config.companionScript) *>> $logPath
  $exitCode = $LASTEXITCODE
  $finished = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Encoding UTF8 -Path $logPath -Value "[$finished] Companion exited with code $exitCode"
  exit $exitCode
} finally {
  $env:COMPANION_TOKEN = $null
  $plainToken = $null
}
