# Oracle capacity and mode comparison

## Evidence and current recommendation

**No native Oracle Ampere A1 capacity has been measured. No simultaneous-browser count is certified for Oracle.** `MAX_ACTIVE=3` is a configurable ceiling; until an accepted local calibration exists the application enforces a one-profile pilot ceiling, and it can reduce that to zero under resource pressure. This provisional ceiling is not evidence that one arbitrary website will fit or stay authenticated.

The checked-in [capacity-results.json](../reports/oracle-free/capacity-results.json) and [CSV](../reports/oracle-free/capacity-results.csv) are the actual **failed x64 development-host** probe of 17 October 2026: the first sandboxed system Chromium launch failed, maximum successful count 0, recommended limit 0, zero sustained samples. The system Chromium's SUID sandbox helper was misconfigured. The probe did not silently retry without the sandbox. The host had a 4-core cgroup quota / 32-GiB limit, other running tests, and is neither clean nor Oracle ARM64. Do not use its available-memory reading as an Ampere recommendation. `completed:true` means the probe ended and wrote its report, **not** that browsers passed; inspect `maximumSuccessful`, `recommendedLimit`, `failedLaunches` and `steps`.

A complete [native ARM64 CI run](https://github.com/oludanielking-afk/My-30-browser/actions/runs/38993083735) passed the fixture ramp: **2 simultaneous profiles**, 30-second holds at each count, **0 crashes**, conservative recommendation **1 profile**. Its configured probe container had a 2-CPU/6-GiB cap. The public notice reports peak process-tree RSS **2205.5 MiB** and minimum available memory **5701.0 MiB**; these readings are specific to that CI environment and RSS double-counts shared pages. Provenance is recorded in [arm64-ci-summary.json](../reports/oracle-free/arm64-ci-summary.json); complete JSON/CSV reports are in that run's `oracle-native-arm64-validation` artifact. This final-source run includes actual kernel-page-size normalization. No CPU percentile is inferred from a summary notice: inspect the actual CSV/soak summaries in the artifact.

These CI results establish compatibility on the runner's actual hardware/resources only. Earlier three-worker x64 30-browser measurements also do not establish capacity on a free A1 VM.

## What the probe measures

`tools/capacity-probe.mjs` calls the compiled, shared-manager-based probe. It creates fresh disposable profiles, installs a locally intercepted neutral HTTPS fixture, opens headed Chromium under the deployment's Xvfb, adds one profile at a time and holds each count for a sustained observation period. It never uses production browser directories, public test websites, real accounts or saved sessions. The ramp runs its own Node manager with Xvfb/Openbox; the production dashboard/noVNC gateway is not actively exercised during this ramp. Validate viewing overhead separately in the integration/soak/pilot workload. It monitors:

- CPU availability/quota and utilization, host available RAM and container usage/limit;
- free disk space, browser startup latency and half-second resource observations during startup;
- two-second sustained resource samples, page JavaScript progress, navigation changes, crashes and request counts;
- exact per-profile Chromium descendant counts/RSS identified by their own user-data-directory arguments;
- observation gaps, failed launches, safety stops and orderly browser cleanup.

Summed process-tree RSS counts shared pages more than once. It is a conservative process metric, not unique physical RAM. Container memory includes the app/viewer/browser/cache together and can include other processes when running natively in a shared cgroup. CPU percentages are normalized to available quota cores for admission; 100% means saturation of that available CPU budget. Oracle RSS sampling reads the actual kernel page size from Linux `AT_PAGESZ` (rather than assuming all ARM kernels use 4 KiB). CPU ticks use Linux ARM64/x64 USER_HZ=100. Other architectures/ABIs are not supported by this edition.

The default reserve is **1536 MiB** (1.5 GiB, slightly more than decimal 1.5 GB); configurations below it are rejected. Launch admission additionally reserves a 1024-MiB per-browser budget plus 512-MiB startup allowance. CPU pressure sustained over three samples above 85%, free disk below 2048 MiB, page failures, crashes or >15-second probe observation gaps stop escalation. The final recommendation subtracts one profile of headroom when two or more counts passed. A one-profile success can recommend one, still subject to workload validation. No claim is made about untested larger counts.

## Run on the actual server

Stop the running manager first. The same volume lock prevents service/probe overlap. Stop other optional workloads and note all remaining host activity. Use the exact image, CPU/RAM settings and disk intended for the pilot.

```sh
sudo docker compose -f deployment/oracle-free/compose.yaml --env-file deployment/oracle-free/.env stop
sudo docker compose -f deployment/oracle-free/compose.yaml --env-file deployment/oracle-free/.env run --rm -e PROBE_MAX=3 -e STEP_SECONDS=300 -e REPORT_DIR=/reports/capacity manager probe
sudo docker compose -f deployment/oracle-free/compose.yaml create
mkdir -p reports/oracle-free/native-oracle
sudo docker compose -f deployment/oracle-free/compose.yaml cp manager:/reports/capacity/capacity-results.json reports/oracle-free/native-oracle/capacity-results.json
sudo docker compose -f deployment/oracle-free/compose.yaml cp manager:/reports/capacity/capacity-results.csv reports/oracle-free/native-oracle/capacity-results.csv
```

The probe exits nonzero for zero recommended capacity, interruption or an exception. The JSON report must be reviewed even when exit status is zero: it may stop escalation below the requested maximum. `STEP_SECONDS` accepts 30–3600; use at least 300 for a pilot baseline and repeat with representative approved workloads. It is a capacity ramp, not a soak test.

After reviewing a complete successful native-server result, install the calibration inside the profile volume and set `MAX_ACTIVE` no higher than `recommendedLimit` in `.env`:

```sh
sudo docker compose -f deployment/oracle-free/compose.yaml run --rm --no-deps --entrypoint node manager -e "const fs=require('fs');const p='/reports/capacity/capacity-results.json',r=JSON.parse(fs.readFileSync(p));if(!r.completed||r.recommendedLimit<1||r.architecture!==process.arch)process.exit(1);fs.copyFileSync(p,'/data/capacity-results.json');fs.chmodSync('/data/capacity-results.json',0o600)"
node deployment/oracle-free/preflight.mjs
sudo docker compose -f deployment/oracle-free/compose.yaml --env-file deployment/oracle-free/.env up -d
```

Calibration is accepted only for compatible architecture, non-smaller available CPU/RAM, at least 30-second steps, matching/stronger reserve/CPU policy and a report less than 30 days old. It is not cryptographic attestation or permission to copy another machine's result. Run it locally; container/machine identity and real website complexity still require operator review. A smaller or unreadable/expired calibration reverts to the one-profile pilot ceiling. Changing startup/browser-budget policies may require a new ramp. Increasing resources never automatically increases the configured or calibrated ceiling.

## Runtime behavior

Before every manual or recovery launch, fresh memory/disk readings and sustained CPU pressure must permit admission. The effective limit is the minimum of configured ceiling, calibrated ceiling and memory headroom. The dashboard explains resource/calibration blocks. A memory-reserve breach for three cycles stops the newest profile and removes its desired-running intent, preventing an automatic restart loop. This protects resources but can interrupt an unsaved form; investigate before restarting. There is no promise that any sampled monitor can prevent every abrupt OS OOM or disk failure.

## Fixture soak and idle/reload comparison

Use a **separate disposable Compose project** with no real account data. The test override enables fixture endpoints and is never used for production:

```sh
sudo docker compose -p oracle-fixture -f deployment/oracle-free/compose.yaml -f deployment/oracle-free/compose.test.yaml build
sudo docker compose -p oracle-fixture -f deployment/oracle-free/compose.yaml -f deployment/oracle-free/compose.test.yaml up -d
sudo docker compose -p oracle-fixture -f deployment/oracle-free/compose.yaml -f deployment/oracle-free/compose.test.yaml exec -T -e BASE_URL=http://127.0.0.1:3000 -e REQUIRE_VIEWER=1 -e REPORT_DIR=/reports/integration manager node tools/oracle-integration.mjs
```

The default example publishes the same loopback port 3000. Stop the production service first, or use an audited port override. The integration prepares only synthetic fixture slots and finishes with browsers stopped; it is destructive to a fixture configuration, so never aim it at real profiles. The test override explicitly requires `NODE_ENV=test`. Test API calls reject non-fixture origins.

For one continuous 24-hour idle observation:

```sh
sudo docker compose -p oracle-fixture -f deployment/oracle-free/compose.yaml -f deployment/oracle-free/compose.test.yaml exec -T -e BASE_URL=http://127.0.0.1:3000 -e MODE=idle -e PROFILE_COUNT=1 -e DURATION_SECONDS=86400 -e REPORT_DIR=/reports/soak-test/idle manager node tools/soak-test.mjs
```

For equal sequential idle/reload observations (600-second smoke comparison, or set 86400 for **each** mode, totaling 48 hours):

```sh
sudo docker compose -p oracle-fixture -f deployment/oracle-free/compose.yaml -f deployment/oracle-free/compose.test.yaml exec -T -e BASE_URL=http://127.0.0.1:3000 -e PROFILE_COUNT=1 -e DURATION_SECONDS=600 -e REPORT_DIR=/reports/comparison manager node tools/compare-modes.mjs
```

Run long commands in a persistent terminal manager or a managed job; an ephemeral chat workspace/hosted CI timeout does not prove endurance. Export results with `docker compose ... cp manager:/reports/soak-test reports/oracle-free/soak-test/` and the equivalent `/reports/comparison` path. All accounts remain synthetic.

A soak pass requires the full steady-state duration, at least 95% of expected ten-second samples, no >30-second wall-clock/monotonic gaps, expected browser count, no failures/crashes, memory/disk reserve, isolated cookie/localStorage values, denied geolocation and advancing page counters. It deliberately fails even a recovered crash so that reliability regressions aren't hidden; the separate integration suite tests successful crash recovery. The final cleanup stops its configured fixture profiles. Incomplete/expired/interrupted runs remain failures or incomplete, never passes. The summary records exact elapsed time, mean/peak CPU/RSS, disk/resource samples, actual intercepted fixture-page requests, errors, crashes, session retention and browser uptime.

No 24-hour Oracle result or sufficiently long comparative measurement currently exists. Do not infer how third-party platforms calculate online status from any of these fixtures. No artificial engagement or reclamation-avoidance traffic is generated.
