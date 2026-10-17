# Oracle pilot test report

Status date: **17 October 2026**. Base: verified `main` `fd75cdd`. All Oracle work is on `free-tier-arm64`; `main` is not changed or merged.

## Implemented

- Single-worker 30-slot Oracle option, independent of the Windows app/three-worker deployment.
- Headed Chromium, Xvfb/Openbox, authenticated noVNC/WebSocket gateway; no public VNC/debug ports.
- Idle and controlled-reload modes using existing scheduling, form/rate/cooldown safeguards; optional exponential failure backoff.
- Owner acknowledgement, notes, launch/reload/error/crash history, unknown login status, bounded local page responsiveness checks.
- Persistent encrypted metadata/cookie checkpoints, dedicated Chromium directories, kernel volume ownership fencing, desired/pause intent and three-attempt recovery.
- CPU/RAM/cgroup/disk readings, configurable/calibrated memory-aware admission and memory-pressure safety stops.
- Incremental capacity probe, startup-spike sampling, observation-gap checks, fixture soak and equal-duration idle/reload comparison tools.
- Docker resource/security configuration, manual eligibility gate and operational/backup documentation.

## Tested locally (x64, not Oracle)

| Check | Actual result |
| --- | --- |
| Strict TypeScript, Vite and all bundles | Passed |
| Unit/integration suite | **16 passed**, including viewer HTTP/WS origin/authentication/revocation and resource-admission cases |
| Existing real Chromium persistence/isolation/geolocation test | Passed, using the existing desktop test configuration on system Chromium/Xvfb |
| Workflow actionlint, JS syntax, Bash syntax and Compose configuration | Passed |
| Eligibility preflight logic | Passed synthetic positive/negative checks: unacknowledged configuration rejected, consistent fixture accepted, over-allocation rejected. No actual account allowance asserted. |
| Dashboard / viewer x64 smoke | Authenticated dashboard displayed 30 cards; actual noVNC RFB connection rendered nontransparent framebuffer pixels and stable logout. This is a separate viewer diagnostic, not a managed Oracle-browser sandbox pass. |
| Oracle sandboxed capacity probe | **Failed first browser launch**; recorded maximum/recommended count 0. SUID sandbox helper is misconfigured on this x64 host. No sandbox-disabled retry is considered a production validation. |
| Local Docker build | **Blocked**: build container could not resolve `deb.debian.org`; no package/TLS verification was disabled. |
| Current Oracle public documentation | **Blocked** by network proxy (403), dated attempted sources in deployment guide. |

A preliminary native x64 integration attempt exercised several synthetic browser behaviors under a development configuration, then failed recovery. It is **not** reported as a completed Oracle integration pass. The finished sandboxed Docker tests must pass independently.

## GitHub validation

Workflow: [Oracle ARM64 pilot validation](https://github.com/oludanielking-afk/My-30-browser/actions/workflows/oracle-arm64.yml).

Complete [run 38993083735](https://github.com/oludanielking-afk/My-30-browser/actions/runs/38993083735), on source `359f599`, passed **all three jobs**:

| Job / check | Actual result |
| --- | --- |
| Native ARM64 build and Docker startup | Passed |
| Headed sandboxed Chromium, independent profiles, denied geolocation | Passed |
| Idle behavior, launch-limit rejection, exact 120-second controlled reload | Passed |
| Actual owned browser-process loss and bounded recovery | Passed |
| Authenticated noVNC RFB connection, remote keyboard input, cookie/logout protection | Passed |
| Controlled container restart and cookie/localStorage restoration | Passed |
| Equal-duration idle/reload fixture smoke | Passed: **130 seconds per mode**, not 24 hours |
| Incremental fixture capacity | Passed: 1 then 2 profiles, 30 seconds/count; recommendation 1 with headroom |
| Windows compatibility | Passed build, unit tests, actual browser persistence/isolation/geolocation and Electron startup |
| Original x64 three-worker cloud compatibility | Passed its 180-second 30-browser fixture/recovery test; not Oracle capacity |

Initial [run 38991196830](https://github.com/oludanielking-afk/My-30-browser/actions/runs/38991196830) was **not** a full pass. Development diagnostics identified an unsupported/swallowed CDP crash command and viewer rendering/logout behavior. The fixture now kills only its exact owned browser process, viewer CSP permits only necessary framebuffer images, and late disconnect events preserve confirmed logout state. Failed intermediate runs are not counted as successes.

The passing final source includes persistent server-backoff suspension, navigation-aware fixture observations, action-button refresh handling and kernel-page-size-correct RSS sampling. Its capacity notice records 2205.5 MiB peak summed process-tree RSS, 5701.0 MiB minimum available memory and zero crashes for two fixture profiles; full resource and mode-comparison reports are in the `oracle-native-arm64-validation` artifact. These are short tests on native ARM CI, not a native Oracle deployment or a 24-hour result.

The workflow runs automatically on pushes to `free-tier-arm64`. It declares `workflow_dispatch`, but GitHub may require the workflow file on the default branch before showing its manual Run button; no default-branch change or merge was performed.

CI uploads only explicitly named synthetic reports; private test state/logs/secrets are excluded. A native `ubuntu-24.04-arm` runner is not Oracle Ampere A1 hardware. QEMU performance is not used.

## Not yet tested / not claimed

- No Oracle instance/account/API connection is available; no native A1 deployment, billing eligibility or region capacity is verified.
- No successful Oracle capacity limit, minimum server specification or real-site resource prediction is established.
- No Oracle 24-hour endurance run has started or completed: **elapsed 0 seconds, status not started**.
- No 24-hour idle-versus-reload comparison: **both elapsed 0 seconds, status not started**. Tools support those runs on an isolated controlled fixture.
- No production website login, account expiry detection, backup restore on OCI, host reboot or reclamation recovery was tested.
- Browser control through a shared desktop is not hostile-tenant isolation. Manual mouse/keyboard journeys need native pilot verification even if the RFB connection test passes.
- The older x64 30-browser endurance process belongs to the existing edition. At the latest separate check it remained incomplete after approximately 5,984 seconds (599 samples, no failed samples); this is historical x64 evidence only. Its partial results do not count as Oracle/ARM64 or idle/reload evidence.

## Pilot acceptance and remaining 24/7 work

Before real use: verify current Oracle/account allowance terms; run a native image/browser/viewer smoke test; pass the native capacity ramp with the final resource caps; choose the measured conservative limit; test manual login and controlled reboot/session recovery; restore an encrypted offline backup; complete gap-free 24-hour fixture tests and comparable idle/reload observations; then test your actual authorized staging workload. Monitor free disk, memory reserve, CPU, crashes, recovery budgets and billing. A CI pass alone cannot establish reliable 24/7 operation or zero cost.
