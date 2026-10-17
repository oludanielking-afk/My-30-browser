import { build } from "esbuild";
await build({
  entryPoints: ["desktop/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/main.cjs",
  banner: {
    js: "if(require('electron').app.isPackaged) process.env.PLAYWRIGHT_BROWSERS_PATH=require('node:path').join(process.resourcesPath,'browsers');",
  },
  external: ["electron", "playwright"],
});
await build({
  entryPoints: ["desktop/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["desktop/worker.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/worker.cjs",
  external: ["express", "playwright"],
});

for (const name of ["worker", "coordinator", "verify", "load"])
  await build({
    entryPoints: [`cloud/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: `dist/cloud-${name}.cjs`,
    external: ["express", "playwright"],
  });

for (const name of ["server", "probe"])
  await build({entryPoints:[`cloud/oracle/${name}.ts`],bundle:true,platform:"node",format:"cjs",outfile:`dist/oracle-${name}.cjs`,external:["express","playwright"]});
