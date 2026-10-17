// Build once with npm run build. The probe never uses production profiles or public sites.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
await require("../dist/oracle-probe.cjs").runProbe();
