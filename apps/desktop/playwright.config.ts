import { defineConfig } from "@playwright/test";

// The PDF engine prepares itself in the background on a real start (it downloads files); a test must not wait for that.
process.env["LUCID_PDF_WARMUP"] = "0";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
