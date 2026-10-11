import { defineConfig } from "@playwright/test";

// The PDF engine prepares itself in the background on a real start (it downloads files); a test must not wait for that.
process.env["LUCID_PDF_WARMUP"] = "0";

/** The acceptance scenarios against the real model in LM Studio: `pnpm e2e:real` (it needs LM Studio running with the model loaded). */
export default defineConfig({
  testDir: "./e2e-real",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
