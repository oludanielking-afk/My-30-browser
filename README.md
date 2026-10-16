# Multi Browser Manager for Windows

A local-first Electron + React + TypeScript desktop application built from the supplied Multi-Browser Account Manager starter. Node.js and Playwright manage 30 independent, persistent Chromium profile directories. The starter's optional authenticated worker API and plain browser dashboard are retained, with the desktop manager's safeguards shared by the worker.

## Run the Windows executables

1. Use 64-bit Windows 10 or 11 with Microsoft Edge installed. The standard executables use **Chromium-based Microsoft Edge**, controlled by Playwright in visible mode. A separately bundled Playwright Chromium build is also supported (below). Node.js is **not** needed to run the executables.
2. Run `MultiBrowserManager-1.0.0-Setup-x64.exe` for a current-user installation, directory selection, Start menu shortcut, desktop shortcut, and uninstaller. Close the application before upgrading or uninstalling.
3. Or run `MultiBrowserManager-1.0.0-Portable-x64.exe` without installing. “Portable” describes application delivery: profile data stays in your Windows account's AppData, **not** beside the executable. Both editions share the same data and cannot run simultaneously.
4. Choose a profile's `···` settings, assign an HTTPS website, save, and click **Open browser**. Log in manually in its visible browser window. No credentials are collected by the dashboard.
5. Automatic reload is off by default. Enable it in settings before starting a browser. Set minimum/maximum seconds within 120–300. While running, use Pause/Resume or Close. Manual reload uses the same safeguards as scheduled reload.

These are unsigned builds. Windows may display an unknown-publisher/SmartScreen prompt. Verify the accompanying SHA256SUMS and review the source. A trusted signing certificate and native Windows acceptance tests are still required for a public production release.

## Behavior and limits

- Exactly 30 slots, each with its own name, assigned website, timing configuration, cookies, local storage, IndexedDB and browser directory.
- Five active browser processes by default, configurable from 1–10. All 30 profiles are usable, but not all 30 run simultaneously. New launches are refused below 1 GB available memory. These are admission limits, not OS-enforced CPU/RAM quotas. Pages and browser extensions can consume additional resources; monitor Task Manager.
- A fresh randomized one-shot delay follows each completed attempt. There is no overlapping reload for a profile, no burst catch-up after sleep, and no automatic launch on app startup.
- At least 120 seconds between attempts per profile, including manual reloads; at least 30 seconds between manager-triggered reloads of the same website origin across profiles.
- Reload applies only to the original managed tab at the exact configured URL. Navigation to another URL or focus in an input, textarea, select or editable element skips that attempt. This is not a general unsaved-form detector.
- HTTP 429/503 immediately pauses automatic reload; three consecutive reload errors also pause it. Resume is explicit. Server-requested backoff is never bypassed by the scheduler. These limits cover manager-triggered top-level reloads, not website subrequests, manual user activity or initial browser navigation.
- Geolocation is blocked by the profile's native Chromium preference and explicitly denied through CDP. Existing geolocation grants are changed to deny; unrelated browser preferences are preserved. This does not mask IP location. Browsers are visible, downloads are disabled, and no stealth, CAPTCHA bypass, fingerprint spoofing or security-evasion features are included.
- Timers stop when browsers close. A crashed tab is shown as an error and can be closed and reopened. Unexpected browser closure leaves data in place; restart that profile manually. Restarting the application does not automatically reopen sites.

## Local storage and security

The vault is inside Electron's per-user application data directory (`%APPDATA%\Multi Browser Manager\vault` on Windows; the exact folder follows Electron's app name). It contains:

- `settings.bin`: metadata encrypted with Electron safeStorage (Windows DPAPI).
- `profile-NN-session.bin`: DPAPI-encrypted checkpoints of session-only cookies, taken every 30 seconds while open and before manager-controlled shutdown. Persistent cookies and site storage remain in their own Chromium directories. Unexpected termination may lose changes since the last checkpoint; persistence does not defeat server logout, expiry or MFA.
- `profiles\profile-01` through `profiles\profile-30`: native browser state. Browser cookies use browser/OS encryption, but localStorage, history, downloads metadata and other profile files are **not all application-encrypted**. Protect your Windows account and use BitLocker for full-disk protection. This application is not a boundary against malware running as your account.

Windows startup fails closed if safeStorage encryption is unavailable. Linux development/worker storage falls back to owner-only files where OS encryption is unavailable; encrypt the worker disk. Never commit the vault or `.env`. Cloud bearer tokens are held only in Electron main-process memory and are discarded on disconnect/exit.

Settings and cookie checkpoint writes use temporary files and atomic rename; settings are flushed before rename. Corrupt/unreadable settings are reported rather than silently overwritten. For backups, close all profiles and exit the app, then copy the entire vault to an encrypted backup. DPAPI-encrypted files are bound to the Windows account/machine; copying to a different account is not a supported migration method. The uninstaller retains vault data. There is no automatic backup or destructive reset button.

The renderer uses sandboxing, context isolation, no Node integration, a narrow preload API, a restrictive CSP, blocked navigation/new windows and denied dashboard permissions. Local desktop control uses IPC rather than an exposed HTTP server. The single-instance lock prevents competing desktop processes from owning the same browser profile directories.

## Build from source on Windows

Use Node.js 22.12+ (Node 24 also works), npm and a 64-bit Windows 10/11 desktop. Build commands from the project root:

```powershell
npm ci
npm run build
npm test
npm run package:win
```

Outputs are under `release/`. The standard build requires Edge on the destination machine. Electron Builder downloads Electron/NSIS and packages the Node runtime and production dependencies. Installers and portable executables are generated with Electron Builder; `build/installer.nsi` is a supported custom NSIS script that creates its uninstaller at installation time. `scripts/after-pack.cjs` generates the exact shipped-file removal list, so uninstall avoids removing unknown files or user profile data. Builds are currently x64 only. The custom script assumes the documented `release/win-unpacked` output directory.

To bundle the Playwright-pinned Chromium instead of relying on Edge:

```powershell
npm run package:win:bundled
```

This downloads the Windows Chromium payload to `windows-browsers/` and includes it in `resources/browsers/`. It increases the executable size. Browser payloads must match the pinned Playwright version. The main-process bootstrap sets the browser location before loading Playwright. When a bundled executable exists it takes precedence; otherwise Windows uses the `msedge` channel. Install or repair Microsoft Edge if launching reports an absent browser.

For development:

```powershell
npx playwright install chromium
npm start
npm run test:browser
npm run test:startup
```

No browser is downloaded on end-user application startup. Standard operation works without a cloud worker; website access still requires your ordinary internet connection.

### Linux cross-build

The same build commands can produce Windows executables on Linux. The custom NSIS script avoids needing Wine to generate the uninstaller. The standard packaging config disables Electron Builder’s Wine-based signing/resource editor. The after-pack hook embeds the application icon and version resources using resedit in JavaScript, and the installer has matching icons. Certificate signing should be configured on a Windows release machine. `scripts/after-pack.cjs` and the NSIS script are included in the source bundle.

This environment uses workspace-local npm/Electron caches because the default home cache is read-only. `.npmrc` places npm's cache one directory above the checkout. Electron download tools can be configured using `electron_config_cache` and `ELECTRON_GET_USE_PROXY=1` when a proxy is required. Never disable TLS or checksum verification. The Electron distributions used for this build were downloaded over HTTPS and checked against Electron's official SHA256 manifest.

## Optional cloud worker

Use a separate Linux worker with a desktop display or a private remote desktop, Node 22+, and Playwright Chromium:

```sh
npm ci
npm run build
npx playwright install --with-deps chromium
# Generate a random token (do not use the example literal):
export ADMIN_TOKEN="$(openssl rand -hex 32)"
export DATA_DIR=/path/to/private/worker-data
export MAX_ACTIVE=5
npm run worker
```

Bind to loopback (default). Put a trusted HTTPS gateway in front, reachable over your private network/VPN. In the desktop app, open **Cloud connection**, enter the HTTPS origin with no path and the token, then connect. Authentication errors, invalid HTTPS URLs and unexpected redirects fail. Data stays on the selected worker; desktop profiles are not synced or uploaded. Close local profiles before switching. Remote reload configuration is editable through the profile settings dialog; remote Pause/Resume buttons are currently hidden in the desktop UI, but available through the worker API. Disconnecting does not stop remote browsers; close them explicitly before disconnecting.

The starter's Docker workflow is also updated:

```sh
cp .env.example .env
# Set a securely generated ADMIN_TOKEN in .env.
mkdir -p data
# Match container uid 10001 on the host.
sudo chown -R 10001:10001 data
chmod 700 data
docker compose up --build -d
```

The port is published to host loopback only. Do not expose raw port 3000. Cloud worker local web controls can be reached with an SSH tunnel. Xvfb provides a display for headed browsers, **not** a remotely visible desktop. Manual cloud sign-in requires a separately secured VNC/RDP session attached to the same display; no remote-desktop service ships with this project. Use one worker process per data directory. Tokens and TLS certificates must be provided by the operator.

The worker API retains `GET /api/profiles`, `PATCH /api/profiles/:id`, and `POST /api/profiles/:id/{start,stop,reload,pause,resume}`, with bearer authentication. All routes use the same manager/store implementation as the desktop app. Existing starter `profiles.json` files are not automatically migrated; preserve those and use a fresh data directory for this version.

## Validation

See [TEST-REPORT.md](TEST-REPORT.md) for executed checks and environment limitations. `npm test` needs a current `npm run build` because its worker integration test launches `dist/worker.cjs`. Browser tests run actual Chromium against an intercepted HTTPS fixture; they do not depend on a public website or bypass TLS validation. Production browser traffic is not intercepted.

A manually triggered Windows build/validation workflow is included at `.github/workflows/windows-release.yml`. No workflow or remote deployment was triggered by this task.

## Download Windows builds from GitHub Actions

Open the repository's **Actions** tab and select **Build Windows application**.
Click **Run workflow**, choose `main`, and start the run. A push to `main` also
starts a build automatically. No local compiler or manually configured secrets
are needed. GitHub Actions must be enabled for the repository, and your account
must be allowed to run workflows (hosted-runner billing or quota limits can also
prevent a run).

When the run succeeds, open its summary and download the
**MultiBrowserManager-Windows-x64** artifact. Unzip it to obtain:

- `MultiBrowserManager-1.0.0-Setup-x64.exe`
- `MultiBrowserManager-1.0.0-Portable-x64.exe`
- `SHA256SUMS.txt`

The checksums are plain `SHA256  filename` lines. You can compare an executable's
hash using PowerShell `Get-FileHash -Algorithm SHA256 <filename>`. Artifacts are
retained for 30 days; rerun the workflow to create a fresh download after expiry.
GitHub requires you to sign in with access to the repository to download its
Actions artifacts. These are unsigned builds; they require installed Microsoft
Edge and use separate persistent profiles, as described above.
