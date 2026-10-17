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
| Workflow actionlint, JS syntax and Bash syntax | Passed |
| Oracle sandboxed capacity probe | **Failed first browser launch**; recorded maximum/recommended count 0. SUID sandbox helper is misconfigured on this x64 host. No sandbox-disabled retry is considered a production validation. |
| Local Docker build | **Blocked**: build container could not resolve `deb.debian.org`; no package/TLS verification was disabled. |
| Current Oracle public documentation | **Blocked** by network proxy (403), dated attempted sources in deployment guide. |

A preliminary native x64 integration attempt exercised several synthetic browser behaviors under a development configuration, then failed recovery. It is **not** reported as a completed Oracle integration pass. The finished sandboxed Docker tests must pass independently.

## GitHub validation

Workflow: [Oracle ARM64 pilot validation](https://github.com/oludanielking-afk/My-30-browser/actions/workflows/oracle-arm64.yml).

Initial [run 38991196830](https://github.com/oludanielking-afk/My-30-browser/actions/runs/38991196830) proved native ARM64 image build and container startup; its browser integration failed, so the overall ARM job was **not a pass**. A diagnostic repeat showed that ARM64 startup, isolation and geolocation worked, but a CDP crash command returned without a crash event. The fixture test now deliberately terminates only its exact owned browser PID and checks real unexpected-process-loss recovery. The Windows compatibility job passed build, unit tests, actual browser persistence/isolation/geolocation and Electron startup. Later validation runs add safe diagnostics and repeat browser tests; consult the final linked result below when updated. The original three-worker compatibility job repeats its 180-second 30-browser fixture/recovery test independently on x64, rather than claiming Oracle capacity from it.

CI uploads only explicitly named synthetic reports; private test state/logs/secrets are excluded. A native `ubuntu-24.04-arm` runner is not Oracle Ampere A1 hardware. QEMU performance is not used.

## Not yet tested / not claimed

- No Oracle instance/account/API connection is available; no native A1 deployment, billing eligibility or region capacity is verified.
- No successful Oracle capacity limit, minimum server specification or real-site resource prediction is established.
- No Oracle 24-hour endurance run has started or completed: **elapsed 0 seconds, status not started**.
- No 24-hour idle-versus-reload comparison: **both elapsed 0 seconds, status not started**. Tools support those runs on an isolated controlled fixture.
- No production website login, account expiry detection, backup restore on OCI, host reboot or reclamation recovery was tested.
- Browser control through a shared desktop is not hostile-tenant isolation. Manual mouse/keyboard journeys need native pilot verification even if the RFB connection test passes.
- The older x64 30-browser endurance process belongs to the existing edition. Its partial results do not count as Oracle/ARM64 or idle/reload evidence.

## Pilot acceptance and remaining 24/7 work

Before real use: verify current Oracle/account allowance terms; run a native image/browser/viewer smoke test; pass the native capacity ramp with the final resource caps; choose the measured conservative limit; test manual login and controlled reboot/session recovery; restore an encrypted offline backup; complete gap-free 24-hour fixture tests and comparable idle/reload observations; then test your actual authorized staging workload. Monitor free disk, memory reserve, CPU, crashes, recovery budgets and billing. A CI pass alone cannot establish reliable 24/7 operation or zero cost.
