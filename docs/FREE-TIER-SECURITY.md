# Oracle pilot security

## Access and trust boundary

The edition is for one trusted owner/operator. Dashboard API requests use a random 256-bit bearer token, held only in page memory. Viewer creation requires that token. Server-side sessions use independent random HttpOnly SameSite=Strict cookies scoped to `/viewer`, a 15-minute expiry, a bounded session map and explicit logout that closes existing viewer sockets. HTTP assets and WebSocket upgrades are authenticated by the Node server; WebSocket Origin must match the configured HTTP/HTTPS scheme and Host. The upstream gateway receives no management token/cookie. A unit test exercises unauthorized HTTP/WS, foreign origins, revocation and an already-open socket.

The only host-published port is **127.0.0.1:3000**. Access through SSH. x11vnc 5900 and websockify 6081 are container-loopback-only and not published. VNC is passwordless solely on that private loopback behind the authenticated gateway; do not change its bind address or run untrusted processes in this container. Xvfb disables TCP listening. There is no public Chromium debugging listener (Playwright uses a pipe). No privileged container, Docker socket, host network or broad host-directory mount is required.

The viewer is a shared desktop: an operator can see every open profile. Profiles isolate website cookies/storage; they do not isolate malicious tenants from a common desktop/operator. Do not distribute viewer sessions to different account owners or host untrusted users together. Clipboard synchronization and VNC file-transfer extensions are disabled/not enabled. Normal browser interaction remains available. Viewer expiry disconnects remote control, not the desired browsers. Close them explicitly when desired.

## Browser and session security

Oracle Chromium starts with its Linux sandbox explicitly enabled, using the pinned official Playwright seccomp policy to permit sandbox namespace syscalls. `no-new-privileges` and a non-root container UID are retained. Startup must fail rather than silently disable the sandbox on an incompatible kernel/security profile. Do not fix failures with `--no-sandbox`, `seccomp=unconfined`, `--privileged`, disabled TLS verification or globally disabled host security controls. See troubleshooting for diagnostics.

Geolocation permission is denied via existing profile preference/CDP logic. This does **not** hide the server's IP; sites can infer an approximate region, and all profiles normally share the same public IP. Profile isolation is not anonymity. No proxy/IP rotation, user-agent rotation, fingerprint spoofing, CAPTCHA/2FA bypass, security challenge evasion or fake online-presence feature exists.

Authenticate accounts manually in the private viewer, or use a method explicitly supported by the website. The application never asks for site passwords, submits password forms automatically, extracts credentials or exposes cookie/checkpoint APIs in production. Browser-native session files are necessary for persistence and can contain sensitive site data. Oracle profile preferences disable browser password saving/autosignin without changing unrelated permissions. Existing manually imported password databases are not deleted automatically; do not import them. This dashboard is not a password manager. Owner acknowledgement and notes document operator intent; they do not prove website consent. Login state is always unknown/manual verification required, even when a page is responsive.

## Storage and keys

Each assigned profile uses its own validated `profile-01`…`profile-30` directory. The whole Oracle volume has a kernel `flock`; a duplicate owner exits 73. Stale-browser recovery matches its persistent random owner marker, exact assigned user-data-dir and Linux PID birth time before terminating an old owned process. It never removes SingletonLocks or kills arbitrary Chromium processes. Profile deletion is intentionally not exposed; offline deletion requires an explicit backup/operator action.

Configuration and Oracle operational state use stable AES-256-GCM keys with authenticated ciphertext. Session-only cookie checkpoints use the existing encrypted store. Cookies, localStorage, IndexedDB, cache and Chromium's native databases are **not fully application-encrypted**; restrict the volume and use encrypted cloud disks and encrypted offline backups. OCI disk encryption does not protect against an account/host compromise; check key/backup settings in the current console. Abrupt loss can lose session changes since the last 30-second checkpoint. Website-side expiry/revocation cannot be prevented.

Secret parents are 0700; mounted secret files are 0444 so uid 10001 can read them. Keep host parent access private. App state uses restricted filesystem permissions and atomic writes; never change volume ownership to world-writable. Never commit `.secrets`, `.env`, profile directories, cookies, sessions, vault keys, OCI API credentials or backup archives. Test private logs/temporary directories are excluded from Git/artifacts. CI uploads only explicitly named synthetic result files. Do not publish production raw samples if assigned URLs/notes may be sensitive.

Key rotation requires offline decrypt/re-encrypt and backup planning; replacing the key randomly will make old state unreadable. Setup preserves existing files. A malformed/undecryptable state fails startup and is not silently overwritten.

## Resource and recovery protections

Configured, calibrated and live memory ceilings all apply. Launches require 1.5-GiB reserve plus startup/browser budgets, sufficient disk and acceptable sustained CPU pressure. Resource-blocked launches show reasons; persistent pressure can stop the newest browser and clear running intent. Crash recovery has three persisted attempts with 30/60/120-second backoff. Explicit operator start/restart resets the budget. Idle mode has no scheduled refresh; controlled mode uses 120–300-second random schedules, a same-origin 30-second gate, cooldowns, form-entry protection, exponential failure backoff and manual-resume pause on 429/503 or repeated failures. There is no rapid catch-up queue.

Docker restart policy is not application failover. Health checks do not restart hung containers automatically. Host OOM, unresponsive kernels, disk loss, OCI reclamation, compromised accounts and unsupported sites remain operational risks. Monitor console billing and resource usage, maintain independent backups, and conduct native-server restore/endurance tests before relying on 24/7 operation.
