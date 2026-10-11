import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

/** Bundles the CLI (the workspace packages are TypeScript source) into a temporary file and runs it with the arguments. */
const dir = mkdtempSync(join(tmpdir(), "lucid-eval-"));
const outfile = join(dir, "eval.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
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
