import { build } from "esbuild";

/** One self-contained file an MCP client can run: `node packages/mcp/dist/lucid-mcp.mjs` (needs only Node 22). */
export async function bundle(outfile = new URL("../dist/lucid-mcp.mjs", import.meta.url).pathname) {
  await build({
    entryPoints: [new URL("../src/bin.ts", import.meta.url).pathname],
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

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`wrote ${await bundle()}`);
}
