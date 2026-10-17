# Oracle edition change manifest

Base: `fd75cdd` on `main`. Delivery branch: `free-tier-arm64`. `A` = added, `M` = modified. No existing test was removed. Original cloud/Windows entry points and deployments remain available. Final executable source was verified in Actions run 38993083735 at `359f599`; subsequent delivery changes are documentation, license notices and synthetic evidence only.

| Status | File |
| --- | --- |
| M | `.dockerignore` |
| A | `.github/workflows/oracle-arm64.yml` |
| M | `.gitignore` |
| M | `README.md` |
| A | `cloud/oracle/privacy.ts` |
| A | `cloud/oracle/probe.ts` |
| A | `cloud/oracle/public/app.js` |
| A | `cloud/oracle/public/index.html` |
| A | `cloud/oracle/public/style.css` |
| A | `cloud/oracle/public/viewer-client.js` |
| A | `cloud/oracle/public/viewer.html` |
| A | `cloud/oracle/resources.ts` |
| A | `cloud/oracle/server.ts` |
| A | `cloud/oracle/viewer.ts` |
| A | `deployment/oracle-free/.env.example` |
| A | `deployment/oracle-free/Dockerfile` |
| A | `deployment/oracle-free/PLAYWRIGHT-LICENSE.txt` |
| A | `deployment/oracle-free/THIRD-PARTY-NOTICES.md` |
| A | `deployment/oracle-free/compose.test.yaml` |
| A | `deployment/oracle-free/compose.yaml` |
| A | `deployment/oracle-free/preflight.mjs` |
| A | `deployment/oracle-free/seccomp.json` |
| A | `deployment/oracle-free/setup.mjs` |
| A | `deployment/oracle-free/start.sh` |
| M | `desktop/manager.ts` |
| A | `docs/FREE-TIER-CAPACITY.md` |
| A | `docs/FREE-TIER-CHANGES.md` |
| A | `docs/FREE-TIER-DEPLOYMENT.md` |
| A | `docs/FREE-TIER-SECURITY.md` |
| A | `docs/FREE-TIER-TEST-REPORT.md` |
| A | `docs/FREE-TIER-TROUBLESHOOTING.md` |
| A | `reports/oracle-free/arm64-ci-summary.json` |
| A | `reports/oracle-free/capacity-results.csv` |
| A | `reports/oracle-free/capacity-results.json` |
| A | `reports/oracle-free/local-validation.json` |
| M | `scripts/build.mjs` |
| A | `tests/oracle-viewer.test.ts` |
| A | `tests/oracle.test.ts` |
| A | `tools/capacity-probe.mjs` |
| A | `tools/compare-modes.mjs` |
| A | `tools/oracle-integration.mjs` |
| A | `tools/oracle-restart.mjs` |
| A | `tools/soak-test.mjs` |

Shared-code changes are optional lifecycle/reload hooks and an optional Chromium sandbox setting in `desktop/manager.ts`, plus two additional build bundles. Existing callers retain their previous options. Oracle runtime logic is under `cloud/oracle`; Oracle-specific Docker/setup files are under `deployment/oracle-free`. No npm dependency versions were changed.
