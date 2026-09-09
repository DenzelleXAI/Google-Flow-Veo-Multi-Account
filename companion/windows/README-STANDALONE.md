Persistent AI Video Studio Companion - Windows Standalone

This package contains a standalone Windows companion executable. Node.js is not required on the target PC.

Contents

- PersistentAIVideoStudioCompanion.exe
- install.ps1
- run.ps1
- uninstall.ps1
- README.txt

Before installation

1. The web application must already be reachable from this PC.
2. The server must have COMPANION_TOKEN configured.
3. You need the same companion token during installation.
4. Choose a local media root with enough free disk space, for example D:\AI Video Studio.

Verify the executable

Run:

  .\PersistentAIVideoStudioCompanion.exe --version

It should print the Persistent AI Video Studio Companion version and exit without contacting the server.

Install

From PowerShell in the extracted artifact folder:

  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

The installer asks for:

- App URL
- Device name
- Media root
- COMPANION_TOKEN

The token is stored using Windows DPAPI through PowerShell SecureString encryption. It is decryptable only in the Windows user context that installed the companion.

Installed files are stored under:

  %LOCALAPPDATA%\PersistentAIVideoStudio

A Startup-folder launcher is created so the companion starts when that Windows user signs in.

Runtime behavior

The companion:

1. heartbeats the registered device and reports free disk space;
2. requests only outputs targeted to that device;
3. receives short-lived signed relay URLs, never R2 credentials;
4. downloads to a temporary .part file;
5. verifies SHA-256 against server metadata;
6. atomically renames the verified file into the canonical media path;
7. reports the verified local replica to the server.

After server-side hash confirmation, the targeted generation can advance to LOCAL_CONFIRMED.

Logs

The default log file is:

  %LOCALAPPDATA%\PersistentAIVideoStudio\companion.log

Uninstall

Run the installed uninstaller or the package copy:

  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1

Uninstall removes the companion app files and Startup launcher. It does NOT delete your configured media root or generated media.

Windows SmartScreen

The GitHub Actions build produces an unsigned executable. Windows SmartScreen may warn when running a newly downloaded artifact. Code signing can be added later for a production distribution channel.

Security notes

- Do not put COMPANION_TOKEN in the repository or a command-line argument.
- The installer requests the token as a SecureString and stores only the DPAPI-protected representation.
- The executable receives the decrypted token through its process environment only while running.
- R2 credentials remain server-side.
- The local SHA-256 check must succeed before a replica is reported verified.
