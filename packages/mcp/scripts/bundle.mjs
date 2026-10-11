import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

/** One self-contained file an MCP client can run: `node packages/mcp/dist/lucid-mcp.mjs` (needs only Node 22). */
export async function bundle(
  outfile = fileURLToPath(new URL("../dist/lucid-mcp.mjs", import.meta.url)),
) {
  await build({
    entryPoints: [fileURLToPath(new URL("../src/bin.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    // Some dependencies are CommonJS and call require().
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  return outfile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`wrote ${await bundle()}`);
}
