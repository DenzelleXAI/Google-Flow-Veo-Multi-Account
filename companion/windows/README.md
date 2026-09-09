# Windows Desktop Companion

The Windows companion keeps the local media library synchronized with completed R2 relay outputs targeted to this PC.

It does **not** need Supabase and does not store R2 credentials locally.

## Recommended: standalone Windows artifact

The recommended distribution is the GitHub Actions artifact named:

```text
Persistent-AI-Video-Studio-Companion-Windows
```

It contains a standalone `PersistentAIVideoStudioCompanion.exe` plus installer/runner/uninstaller scripts. **Node.js is not required on the target PC.**

After extracting the artifact, verify it:

```powershell
.\PersistentAIVideoStudioCompanion.exe --version
```

Then install:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

The installer asks for the app URL, device name, media root, and `COMPANION_TOKEN`. The token is stored with Windows DPAPI for the current Windows user.

Because the GitHub Actions executable is currently unsigned, Windows SmartScreen may warn on first launch. Code signing can be added later for production distribution.

## Development fallback: Node-based installer

The repository also keeps a Node-based companion installer for development and troubleshooting.

Requirements:

- Windows 10/11
- Node.js 22 or newer
- A reachable Persistent AI Video Studio server
- The same `COMPANION_TOKEN` configured on that server

From the repository directory:

```powershell
npm run companion:windows:install
```

The installer asks for:

- App URL, such as `https://your-studio.example.com`
- Device name, such as `HOME-PC`
- Media root, such as `D:\AI Video Studio`
- `COMPANION_TOKEN`

The token is entered as a PowerShell `SecureString` and persisted using Windows DPAPI for the current Windows user. It is not written to the repository and is not placed in the Startup command.

Installed runtime files live under:

```text
%LOCALAPPDATA%\PersistentAIVideoStudio\
```

## Startup behavior

At Windows sign-in the Startup launcher runs the companion hidden.

The companion:

1. heartbeats the device and reports free disk space
2. requests only outputs targeted to that device
3. receives short-lived signed R2 URLs
4. downloads to `.part`
5. verifies SHA-256
6. atomically renames the verified file
7. reports the verified replica back to the server

Temporary network/server failures do not terminate the normal companion loop. It retries on the next 30-second cycle.

## Logs

Default log:

```text
%LOCALAPPDATA%\PersistentAIVideoStudio\companion.log
```

The local device ID remains persisted inside the configured media root by the companion itself, so reinstalling the Windows launcher does not intentionally create a new device identity.

## Update

For the standalone package, download the newest GitHub Actions artifact and run its `install.ps1` again. The installer stops only the previously installed companion executable before replacing it.

For the Node development path, pull the latest repository version and run:

```powershell
npm run companion:windows:install
```

Your configured media folder is not modified by either update path.

## Uninstall

Standalone artifact:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Node development path:

```powershell
npm run companion:windows:uninstall
```

Uninstall removes the Startup launcher, installed companion runtime, DPAPI-protected config, and companion app directory. It **does not delete the configured media root or generated videos**.

## Security model

- No R2 access key is stored on the PC.
- The browser/companion receives only short-lived signed R2 object URLs.
- `COMPANION_TOKEN` is protected by Windows DPAPI for the current Windows user.
- The DPAPI ciphertext cannot normally be decrypted by another Windows user account.
- Server-side SHA-256 verification is still authoritative before a replica becomes `LOCAL_CONFIRMED`.
