import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "lucid-experiment-"));
const outfile = join(dir, "experiment.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../src/experiment/main.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "warning",
});
const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
