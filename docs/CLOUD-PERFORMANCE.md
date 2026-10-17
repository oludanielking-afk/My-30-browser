# Cloud performance and validation report

## What has actually been demonstrated

On 17 October 2026, **30 real, simultaneously active Chromium profile contexts across three native Linux worker processes passed a 180-second controlled fixture capacity window**. All 18 ten-second samples observed exactly 30 running profiles and three healthy workers, with no failed health samples. Each profile had independently seeded synthetic cookies and localStorage. Repeated authenticated functional probes evaluated the real fixture pages, checked those isolated values and checked JavaScript counter progress across samples (or a new document after reload).

The subsequent integration checks passed: invalid authentication rejected; a worker refused another shard's profile; the kernel rejected a duplicate volume owner; the cluster reload gate denied a second immediate same-origin request; a tab recovered after a deliberate crash; a worker recovered after forced process loss; and cookies/localStorage remained isolated after browser/worker restarts. Recovery checks ran **after** the steady-state capacity window, so outages were not hidden inside the zero-failure capacity number.

The application unit/integration suite passed **12 tests**, and the existing real-browser persistence/geolocation test passed. Strict TypeScript/build checks and workflow linting passed. The GitHub cloud validation workflow independently passed build, all 12 tests, Docker image build/control-plane startup, and the complete three-worker 30-browser native fixture/recovery suite in [run 38987123836](https://github.com/oludanielking-afk/My-30-browser/actions/runs/38987123836), testing commit `e430b14`. Its `cloud-validation-reports` artifact contains the measured summary, raw samples and final integration result. Earlier CI attempts completed browser checks but failed when reporting a quota file absent on native GitHub VMs; missing controller limit files are now explicitly reported as unavailable, without relaxing any browser assertion.

Evidence committed with this report:

- [Measured summary](../reports/capacity-fixture-summary.json)
- [Integration result](../reports/capacity-fixture-integration.json)
- [Resource samples](../reports/capacity-fixture-samples.csv)

An earlier development trial also completed the capacity window; the final evidence above is from the second run, which completed the recovery checks with the final worker ownership/recovery implementation. This report does not convert an interrupted or failed check into a pass.

## Host, fixture and results

| Item                                    |                                              Observed value |
| --------------------------------------- | ----------------------------------------------------------: |
| CPU cgroup quota                        |                                 4 vCPUs (`400000 / 100000`) |
| RAM cgroup limit                        |                                                      32 GiB |
| CPU visible to `os.cpus()`              | 5 logical CPUs; quota, not this count, constrained the test |
| Worker layout                           |            3 processes × 10 independent persistent contexts |
| Browser mode                            |                          Visible system Chromium under Xvfb |
| Hold duration                           |          180 seconds, excluding startup and recovery checks |
| Running profile count                   |                                             min 30 / max 30 |
| Failed status samples                   |                                                      0 / 18 |
| Mean aggregate worker-tree CPU          |                        53.9% = approximately 0.54 CPU cores |
| Median aggregate worker-tree CPU        |                        34.3% = approximately 0.34 CPU cores |
| Peak / small-sample p95 worker-tree CPU |                       348.2% = approximately 3.48 CPU cores |
| Peak aggregate process-tree RSS         |                       16,553.9 MiB, approximately 16.17 GiB |
| Peak distinct-cgroup memory usage       |                       11,476.3 MiB, approximately 11.21 GiB |
| Final fixture profile data on disk      |                     approximately 170 MB across 30 profiles |

The fixture is owned by this application at the reserved `https://fixture.invalid/` origin and is fulfilled by Playwright routing, not a public site's server. Each page has a small DOM and executes a two-millisecond task each second, updating a counter. It uses no video, substantial images, heavy web applications, real accounts or third-party traffic. This is an authorized, reproducible baseline, **not a production website benchmark**. Chromium may throttle background work normally; no throttling/fingerprint evasion is implemented.

CPU sampling includes each worker's browser descendant processes; 100% equals one core, not 100% of the four-core host. RSS sums shared library pages more than once, so it is an upper bound and must not be called unique physical RAM. The native workers share one cgroup: the cgroup memory number is deduplicated, includes other processes/file cache in this cloud environment, and is not the sum of three separate worker containers. No clean pre-run incremental-memory baseline was captured. Eighteen samples are too few to make high-confidence tail-latency or uptime claims. Brief events between samples can be missed.

## Initial server specifications

For an initial single-host deployment of **three ten-profile workers plus the coordinator**, choose **16 vCPU, 32 GiB RAM and at least 100 GiB encrypted SSD/NVMe**, then validate your actual authorized workload before relying on that plan. This is a conservative starting estimate, not a measured universal minimum or a guarantee of 24-hour operation.

The reasoning is explicit:

- The measured peak of 3.48 cores suggests approximately 7 cores with a 2× startup/load allowance for this fixture alone. Three 4-core worker caps plus one coordinator core can demand 13 cores concurrently, so a 16-core host leaves scheduling headroom. Real dynamic websites may exceed the fixture by a large factor.
- The conservative 16.17 GiB RSS sum × 1.5 allowance plus approximately 4 GiB for the OS/control plane suggests about 28.3 GiB; 32 GiB is a practical initial tier. Compose caps workers at 8 GiB each and the coordinator at 512 MiB. This calculation uses an intentionally conservative RSS bound; it is not a per-site memory prediction.
- The tiny fixture data set is not a storage requirement for real browsing. Budget for browser caches/history, image layers, logs and encrypted backups. The proposed 100 GiB is an operational starting allocation, not a measured long-term disk minimum.

For three separate worker machines, start with **4 vCPU / 8 GiB per worker**, with a separate small coordinator (approximately 1 vCPU / 1 GiB). Prefer more headroom if workers run heavyweight applications. Monitor per-container cgroup memory, sustained CPU, process limits, crash rate and disk growth. Increase RAM/CPU or reduce the admitted count when memory stays above 80%, CPU saturation is sustained, functional probes stall, or recovery starts blocking. Do not solve overload by disabling safeguards or blindly increasing limits.

## Docker status

Compose configuration passed validation. This cloud environment could not build the final image because the proxy denied the official Microsoft image-layer host `westus.data.mcr.microsoft.com`. No verification was disabled, no alternate untrusted image was used, and the native process results are **not labeled as Docker runtime results**. GitHub Actions did successfully build the image, boot all three worker APIs plus the coordinator, verify readiness and stop the control plane in the run linked above. This verifies Docker build/startup with no active production sites, not a 30-browser Docker load test. A 30-browser test under the exact production container CPU/RAM limits remains a deployment acceptance task unless an actual later report records it.

## 24-hour endurance status

A background 86,400-second fixture run has been requested on this cloud machine. Its exact startup/heartbeat status is recorded in [endurance-status.json](../reports/endurance-status.json). **No completed 24-hour endurance pass is claimed.** The ongoing result is under `reports/endurance-20261017-gapguard/summary.json`; a genuine pass requires `completed:true`, zero failed samples and the final `integration.json` after recovery checks.

This is an ephemeral development environment. Suspension, expiration or resource reclamation can interrupt the run; if the process/heartbeat stops, the result is incomplete. The manual dedicated-runner workflow and the deployment guide provide a reproducible way to conduct the full test on a persistent host. GitHub-hosted runners cannot perform a single 24-hour job; the dedicated workflow uses an explicitly provisioned `mbam-endurance` self-hosted label and a 26-hour timeout. No self-hosted runner was provisioned or assumed connected.

## Acceptance before real production use

Repeat the controlled test inside the deployed containers, then run approved journeys against your own staging websites under the intended resource limits for at least 24 hours. Measure functional failures and session retention in addition to browser counts. Test host/container restarts and offline backups/restores. Native Windows installer checks, real third-party login flows and remote-desktop authentication are separate from this cloud fixture benchmark. Thirty active processes alone do not prove thirty usable production sessions.

The endurance harness now requires at least 95% of the expected ten-second samples and rejects observation gaps longer than 30 seconds, including a gap at the end of the run. A suspended VM cannot pass solely because its wall clock advanced by 24 hours. The earlier 510-second partial endurance trial was stopped and the 24-hour clock restarted with this guard; neither trial is reported as a completed endurance pass.
