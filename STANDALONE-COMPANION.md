# Standalone Windows Companion

The repository builds a Windows companion artifact through `.github/workflows/companion-windows.yml` using Node.js 26 Single Executable Applications (SEA).

Artifact name:

```text
Persistent-AI-Video-Studio-Companion-Windows
```

The package contains:

```text
PersistentAIVideoStudioCompanion.exe
install.ps1
run.ps1
uninstall.ps1
README.txt
```

The target Windows PC does not need Node.js installed.

## Build verification

The Windows workflow must pass these checks before publishing the artifact:

1. Build the `.exe` using `node --build-sea` and an ESM SEA configuration.
2. Execute the generated binary with `--version`.
3. Package the DPAPI-backed installer/runner/uninstaller scripts.
4. Upload the complete package as a GitHub Actions artifact.

## Installation

Extract the artifact and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

The installer stores the executable and configuration under `%LOCALAPPDATA%\PersistentAIVideoStudio`, protects `COMPANION_TOKEN` with Windows DPAPI, creates a Startup launcher, and preserves the configured media root during updates/uninstall.

See `companion/windows/README-STANDALONE.md` for operational and security details.
