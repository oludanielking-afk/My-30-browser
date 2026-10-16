# Validation report

Build host: Debian 13 Linux x64, Node 24.19.0. Target: Windows x64. Final runtimes: Electron 44.8.0, Playwright 1.64.1, Express 5.3.0.

## Executed

- `npm run build`: strict TypeScript check, Vite React production build and esbuild Electron/preload/worker bundles.
- `npm test`: eight tests for thirty-slot persistence, independent settings, invalid URL/range rejection, corrupt-file preservation, timer pause/resume, exact scheduled execution, cooldown/navigation checks, focused-form skip, per-origin throttling, 429 backoff, worker startup/authentication/update validation/graceful shutdown.
- `DISPLAY=:99 TEST_CHROMIUM=/usr/bin/chromium npm run test:browser`: real visible Chromium contexts on a virtual display. Tests cookie isolation, localStorage isolation, persistent cookie retention, session-only cookie checkpoint retention, localStorage retention after close/reopen, denied geolocation, cooldown and concurrency rejection. Site responses are served by Playwright routing at an HTTPS fixture origin so the tests require no public website access.
- Electron startup under Xvfb: React renders all 30 cards and calls the real preload/main-process snapshot API. Screenshot captured as `dashboard.png`. Linux test used `--no-sandbox` because the container cannot configure Chromium's setuid sandbox; **this flag is not in the Windows application or its startup commands**.
- Production dependency audit (`npm audit --omit=dev`): zero reported vulnerabilities at build time. This does not replace a security review.
- Windows Electron payload checked against Electron's official SHA256 manifest before packaging.

## Packaging and limitations

Electron Builder completed both targets successfully (exit 0):

- `MultiBrowserManager-1.0.0-Setup-x64.exe`: 163,594,782 bytes.
- `MultiBrowserManager-1.0.0-Portable-x64.exe`: 117,853,455 bytes.

Both NSIS containers passed 7-Zip 25.01 integrity/extraction checks. The portable’s embedded 7z payload also passed archive testing. The app executable and ASAR extracted from both delivery formats match the validated `win-unpacked` files byte for byte. The ASAR header hash matches the integrity resource embedded in the Windows executable, and the final packed main-process bundle matches the tested source build. Icon and version metadata were inspected. Both EXEs have empty Authenticode certificate tables: **unsigned**. SHA256SUMS.txt accompanies the downloads.

The build initially lacked Wine; the supported custom NSIS script removed that build dependency. An initial archive check used the reduced 7za binary, which cannot read the NSIS installer format; the subsequent full 7-Zip checks passed. A successfully generated and inspected PE executable is not proof of native Windows execution.

Not run here: Windows installer/portable launch, install/uninstall/upgrade behavior, Edge channel launch, Windows DPAPI/ACL behavior, Windows sleep/resume, native crash recovery, 30-profile long-duration stress tests, all possible site's login flows, certificate signing/SmartScreen reputation, a live cloud HTTPS gateway/remote desktop, and Docker deployment. These require a Windows machine or operator-managed cloud services.

Playwright browser-download domains were denied by this environment's network proxy. The standard Windows artifacts therefore use installed Chromium-based Microsoft Edge; an optional bundled-browser build is documented. Requests to add `cdn.playwright.dev` and `playwright.download.prss.microsoft.com` were saved in the environment draft; applying them requires review/save/publish in environment settings. This is unnecessary for running the standard Edge-based Windows package.

The standard app has no signing certificate and no automatic updater. Treat these as unsigned release candidates pending Windows acceptance, security review and signing before broad distribution.

## Native acceptance follow-up

The manual `.github/workflows/windows-release.yml` workflow installs the pinned browser, runs the tests on Windows and uploads both EXEs. It is provided but was not triggered in this task. Before distribution, test manual sign-in in two profiles, restart both delivery formats, verify permissions and session persistence, exercise install/upgrade/uninstall, and validate resource use and sleep/resume on a real Windows workstation.
