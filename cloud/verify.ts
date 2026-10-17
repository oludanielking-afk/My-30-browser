import fs from "node:fs/promises";
import { secret } from "./common";
export async function verify(url: string, token: string) {
  const r = await fetch(url + "/api/status", {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error(`Coordinator HTTP ${r.status}`);
  const data = await r.json();
  if (
    !data.allHealthy ||
    data.workers.length < 3 ||
    data.running !== 30 ||
    data.profiles.length !== 30 ||
    new Set(data.profiles.map((p: any) => p.id)).size !== 30 ||
    data.profiles.some((p: any) => p.state !== "running" || !p.browserOpen) ||
    data.workers.some(
      (w: any) => w.running !== w.profiles.length || w.profiles.length > 10,
    )
  )
    throw Error("30 healthy, assigned, running profiles were not observed");
  return data;
}
if (require.main === module)
  void (async () => {
    const value = await verify(
      process.env.COORDINATOR_URL || "http://127.0.0.1:3000",
      await secret("ADMIN_TOKEN"),
    );
    console.log(
      JSON.stringify(
        {
          observed: true,
          running: value.running,
          workers: value.workers.map((w: any) => ({
            id: w.id,
            running: w.running,
            resources: w.resources,
          })),
          timestamp: Date.now(),
        },
        null,
        2,
      ),
    );
    if (process.env.REPORT_FILE)
      await fs.writeFile(
        process.env.REPORT_FILE,
        JSON.stringify(value, null, 2),
      );
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
