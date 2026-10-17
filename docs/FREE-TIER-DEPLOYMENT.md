# Oracle Always Free ARM64 pilot

This is an **additional** single-worker option on branch `free-tier-arm64`, based on `main` commit `fd75cdd`. It does not replace the Windows application or `deployment/compose.yaml` (three x64 workers / 30 slots). No Oracle instance, account, subscription or chargeable service is provisioned by these files. A server continues working while your PC is off; an SSH tunnel/viewer disconnect does not stop the containers. Oracle reclamation, account suspension, quotas, server outages and website-side session expiry still apply.

## Official-source research and eligibility gate

Checked/attempted **17 October 2026**. Direct requests to Oracle's official documentation, FAQ and pricing hosts were rejected by this execution environment's network proxy (HTTP 403). **Their current contents were not verified.** Do not treat the historical reference values below as current entitlements or as a $0 guarantee. The deployment preflight requires you to check your own account's current console allowances and remaining usage; it cannot query Oracle billing or certify free eligibility.

| Topic / official reference | Status and what you must verify |
| --- | --- |
| [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | Retrieval blocked. Historical A1 reference: 3,000 OCPU-hours and 18,000 GB-hours/month, commonly described as 4 OCPUs / 24 GB across eligible A1 instances. **Account/tenancy aggregate, not a fresh allowance per VM. Confirm current terms.** |
| Same resource reference: storage | Retrieval blocked. Historical reference: 200 GB combined eligible boot/block volumes in the home region. Confirm currently included capacity, minimum boot volume, backup allowance, volume performance tier and all existing volumes/backups before choosing a size. |
| [Ampere A1 compute](https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm) | Retrieval blocked. Select `VM.Standard.A1.Flex`, ARM64/aarch64 Ubuntu 24.04 LTS (non-Pro, no licensed image), explicitly labelled Always Free eligible in your region. Confirm exact available image and supported configuration in the console. Ubuntu x64 images cannot run on A1. |
| [Free Tier FAQ](https://www.oracle.com/cloud/free/faq/) | Retrieval blocked. Confirm country/account eligibility, identity/payment-card verification and possible temporary verification holds, trial versus Always Free status, home-region restriction and account limits. A valid card does not guarantee regional A1 capacity. Do not create extra accounts to bypass limits. |
| [Network pricing](https://www.oracle.com/cloud/networking/pricing/) | Retrieval blocked. Historical reference: first 10 TB outbound/month was included for qualifying usage; confirm current region/service-specific egress, public IPv4 and cross-region charges. Verify ingress, ephemeral/reserved public-IP rules, NAT gateways, internet gateway and network-resource allowances. No paid NAT/load balancer is created here. |
| Always Free idle reclamation policy (resource reference above) | Retrieval blocked. Historically assessed over seven days using low CPU/network and, for A1, memory utilization; exact percentile/threshold rules must be checked now. An idle browser workload can still qualify as idle. **Never generate artificial load to evade reclamation.** |
| Provider acceptable use / continuous operation | Review your accepted Oracle agreement, current Free Tier terms and [Acceptable Use Policy](https://www.oracle.com/legal/terms.html). No policy exception for browser workloads is assumed. Website permission is a separate requirement. |

Official compatibility sources successfully retrieved on the same date:

- [Pinned Playwright 1.64.1 registry](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/registry/index.ts) includes `linux-arm64` Chromium paths.
- [Pinned Playwright Chromium sandbox seccomp policy](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json), copied verbatim to `deployment/oracle-free/seccomp.json`.
- [Official Playwright Docker recipe](https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble), reviewed for installation practice. This edition uses multi-platform `node:24-bookworm` and installs only the pinned Chromium package plus Debian viewer tools; it does not depend on an x64-only browser image.

Node 24, Playwright 1.64.1 and the existing npm lockfile are retained. Its installed `browsers.json` declares Chromium/Chrome for Testing **156.0.8078.4, revision 1248**, including the corresponding headless shell; the Oracle manager uses headed Chromium, not the shell. TypeScript/esbuild/React versions are unchanged. Electron is built for compatibility but not launched in the Oracle container. Debian provides ARM64 Xvfb, Openbox, x11vnc, noVNC and websockify through signed package repositories. Image/package security updates require rebuilding; the Node major/distribution tags and Debian packages are moving security-update inputs rather than frozen image digests. Record deployed image IDs and package versions for a release. No unmaintained Chromium binary, snap-in-Docker workaround or fingerprint/evasion option is added.

### Free-tier verification checklist (before creating anything)

- [ ] Read the official sources above from your own network and record the date/current terms.
- [ ] Account is eligible, Always Free remains active after any trial, and this is the eligible home region.
- [ ] A1 shape and Ubuntu ARM64 image show the free-eligible label; no paid image or service is selected.
- [ ] Subtract every existing A1 instance's usage from the account's OCPU/RAM allowance.
- [ ] Subtract all existing boot/block volumes and backups from current included storage; check performance/backup charges separately.
- [ ] Confirm available A1 regional capacity. An out-of-capacity error is not permission to select a paid shape.
- [ ] Check public IPv4, bandwidth/egress and regional networking prices, including resources elsewhere in the account.
- [ ] Review the estimated-cost panel and billing/cost analysis. Configure a free budget notification if available; **a budget alert is not a spending cap**.
- [ ] Keep only SSH open from your own IP. No public 3000/5900/6081/9222 ports.
- [ ] Understand idle reclamation and maintain independent offline backups. No permanent instance availability or universal $0 outcome is promised.

## Create the instance manually

1. In the OCI console, choose the eligible home region and create one compute instance. Select the free-labelled `VM.Standard.A1.Flex` configuration within **remaining** account allowances. A possible historical full-account candidate was 4 OCPUs / 24 GB, but verify it rather than blindly selecting it.
2. Choose a free Ubuntu ARM64 image, such as available non-Pro Ubuntu 24.04 LTS aarch64. The container userspace is Debian Bookworm and runs on that Ubuntu host kernel.
3. Choose an eligible boot-volume size within the aggregate allowance (the example config uses 50 GB; the console/image may require a larger minimum). Use the normal included performance tier only after verifying its price. Extra volumes/backups are not automatically free.
4. Generate a key on your PC: `ssh-keygen -t ed25519 -f ~/.ssh/mbam-oracle`. Upload only the `.pub` key. Keep the private key off Git and off the server image.
5. Use one VNIC/private address. If a public address is needed for SSH, verify its current price and eligibility. Restrict ingress TCP 22 to your current public IP in both the NSG/security list and host firewall. Do not open app, VNC, WebSocket or debugging ports. Do not create load balancers, managed databases or NAT services for this application.
6. Review the console cost estimate and create only after every resource is explicitly verified eligible. Save that review; this repository has no cloud provisioning credentials.

## Prepare Ubuntu ARM64

Connect from your PC (replace placeholders):

```sh
ssh -i ~/.ssh/mbam-oracle ubuntu@SERVER_IP
uname -m
free -h
df -h /
```

`uname -m` must show `aarch64`. Install Docker using the official apt-repository method from [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/) (that page was also proxy-blocked here; check its current instructions before use):

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Docker group membership grants root-equivalent access. The commands below use `sudo docker` rather than assuming an unprivileged Docker socket. No app container receives the socket. If another Docker install exists, follow Docker's migration instructions instead of blindly replacing packages. Install Node 24 LTS for the small setup/preflight scripts using a trusted, checksum-verified distribution; all app build/runtime dependencies are inside Docker. Verify `node --version` (24.x). If you prefer not to install Node on the host, use the official multi-platform Node container for these two setup steps instead:

```sh
sudo docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24-bookworm node deployment/oracle-free/preflight.mjs
sudo docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24-bookworm node deployment/oracle-free/setup.mjs
```

Run those after cloning the repository and filling in `.env` as described below. They mount only the project directory, not the Docker socket or your home directory.

## Download and configure

```sh
git clone --branch free-tier-arm64 https://github.com/oludanielking-afk/My-30-browser.git
cd My-30-browser
cp deployment/oracle-free/.env.example deployment/oracle-free/.env
nano deployment/oracle-free/.env
```

Fill in `ALLOWANCE_CHECKED_ON` with a recent ISO date and **actual verified remaining** free OCPUs, RAM and storage available to this deployment (aggregate allowance minus unrelated resources; do not subtract the selected VM/boot volume twice after creation). Set selected instance values to the VM you created. Set `FREE_TIER_VERIFIED=yes` only after checking them. Default container candidates are 3 CPUs / 18 GiB, leaving host overhead on a historical 4-core/24-GB configuration; reduce these on a smaller eligible VM. Keep at least 2 GiB outside the container. `MEMORY_RESERVE_MB` cannot be below 1536, launch budget defaults to 1024 MiB/browser plus 512 MiB startup allowance. These are guards, not proven per-site usage estimates.

```sh
node deployment/oracle-free/preflight.mjs
node deployment/oracle-free/setup.mjs
sudo docker compose -f deployment/oracle-free/compose.yaml --env-file deployment/oracle-free/.env config --quiet
sudo docker compose -f deployment/oracle-free/compose.yaml --env-file deployment/oracle-free/.env build
sudo docker compose -f deployment/oracle-free/compose.yaml --env-file deployment/oracle-free/.env up -d
sudo docker compose -f deployment/oracle-free/compose.yaml ps
```

Setup creates/preserves independent 256-bit management and vault keys, prints no key material, and refuses unacknowledged allowance settings. It does not call Oracle or prove account eligibility. `.env` and `.secrets` are ignored by Git. The 0700 secret parent protects files on the host; 0444 file mode permits the non-root container UID to read the mounted files. Profile and report volumes are different from the original cloud deployment. Never share a live profile volume between editions.

## Private dashboard and manual login

On your PC, leave this tunnel open while viewing:

```sh
ssh -N -L 3000:127.0.0.1:3000 -i ~/.ssh/mbam-oracle ubuntu@SERVER_IP
```

Open `http://127.0.0.1:3000`. Privately read the management token from `deployment/oracle-free/.secrets/admin-token` on the server and enter it in the dashboard; don't paste it into shell history, URLs, screenshots or GitHub. The UI clears the input and holds the token in page memory only. The service is bound to host loopback, even though the Node listener binds inside its private container.

Configure any permitted slot: HTTPS website, display name, owner authorization acknowledgement, notes and mode. The default is IDLE with automatic refreshing disabled. Controlled reload additionally requires actual website permission; checking a box does not establish it. Start one profile first. The uncalibrated pilot ceiling is one, not a promise that even one arbitrary site will fit. Configure a larger active ceiling only after [capacity testing](FREE-TIER-CAPACITY.md).

Click **Open secure browser viewer**, then the viewer link. Browser windows are displayed through Xvfb/Openbox/noVNC. Use normal mouse/keyboard to log in manually. Use **view** on a profile to bring it forward. No website password is requested by the dashboard. Viewer HTTP assets and WebSocket upgrades require a server-validated, opaque HttpOnly SameSite cookie. Sessions expire after 15 minutes and are revoked with **End session**, including open sockets. VNC and raw websockify listen only inside the container on loopback. Clipboard synchronization and file-transfer extensions are not enabled. The viewer is a single trusted operator's shared desktop, not per-profile tenant isolation.

The tunnel is only needed for management/viewing. Closing it or turning off the PC does not stop the server. An optional HTTPS reverse proxy must be privately authenticated, preserve Host/Origin, support WebSocket upgrades and set `COOKIE_SECURE=1`; no public gateway/TLS automation is supplied. Do not expose raw viewer/worker ports.

## Capacity, health and operational commands

See [capacity measurements and commands](FREE-TIER-CAPACITY.md). `/health/live` means process liveness only; authenticated `/health/ready` means the API is ready. Neither certifies an active browser or account login. Dashboard page responsiveness is a bounded local JavaScript check, not a website request or a login-status detector. All login states remain unknown/manual verification required.

```sh
sudo docker compose -f deployment/oracle-free/compose.yaml logs --tail=100 manager
sudo docker stats
sudo docker compose -f deployment/oracle-free/compose.yaml restart manager
sudo docker compose -f deployment/oracle-free/compose.yaml stop
sudo docker compose -f deployment/oracle-free/compose.yaml up -d
```

Compose automatically reads `.env` beside its first Compose file for ordinary settings; use the explicit `--env-file` form above if running from another directory or overriding Compose environment behavior. After server reboot, enabled Docker plus `restart: unless-stopped` starts containers that were not deliberately stopped. Desired browser intent, mode and pause state survive controlled restarts. Recovery is limited to three attempts with 30/60/120-second backoff; resource-blocked launches wait rather than spin. A sustained memory reserve breach stops the newest active profile, clears its running intent, and requires manual review. Health checks do not automatically restart a merely hung Docker container; alert/investigate manually.

## Offline backup and restore

Stop the service before backing up. Back up both the profile volume and stable secret files to independently encrypted storage; cloud boot disk survival is not an independent backup. Do not put session backups in Git or public artifacts.

```sh
sudo docker compose -f deployment/oracle-free/compose.yaml stop
mkdir -m 700 -p backups
sudo docker compose -f deployment/oracle-free/compose.yaml run --rm --no-deps --entrypoint tar manager -C /data -czf - . > backups/oracle-profiles.tgz
chmod 600 backups/oracle-profiles.tgz
```

Encrypt that archive with your trusted backup tool before moving it off the host, and separately back up `.secrets` securely. To restore into a stopped, matching installation with its original keys:

```sh
sudo docker compose -f deployment/oracle-free/compose.yaml run --rm --no-deps -T --entrypoint tar manager -C /data -xzf - < backups/oracle-profiles.tgz
sudo docker compose -f deployment/oracle-free/compose.yaml up -d
```

Restore trusted archives only. Never extract a backup while the service/probe owns the volume. Test a backup restore into an isolated copy before relying on it. `down` retains named volumes; **`down -v` deletes them**. A lost vault key cannot be recovered from browser storage or management tokens.

## Updating and scaling

Stop/backup, review the incoming branch changes, fetch/pull `free-tier-arm64`, rerun preflight, rebuild the image and bring it up without deleting volumes. Keep the previous image ID and backup for rollback. Repeat capacity tests after changing browser/image/host/resources or workload. Do not increase CPU/RAM/storage above free allowance silently. A paid larger server is an explicit separate operator decision. The original three-worker deployment remains available for scaling, but shard/key/profile migration is manual and requires an offline plan.

## Known acceptance gaps

No Oracle account or native Ampere A1 server is connected to this environment. Current Oracle entitlements cannot be verified here. ARM runner validation, if passed, is native ARM CI **not Oracle hardware validation**. No completed Oracle 24-hour run or 24-hour idle/reload comparison is claimed. See [test report](FREE-TIER-TEST-REPORT.md), [security](FREE-TIER-SECURITY.md) and [troubleshooting](FREE-TIER-TROUBLESHOOTING.md) before piloting real sites.
