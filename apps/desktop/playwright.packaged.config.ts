import { defineConfig } from "@playwright/test";

/** The built app (`pnpm dist:dir` first): `pnpm e2e:packaged`. It runs release/mac-arm64/Lucid.app the way a person who installed it would. */
export default defineConfig({
  testDir: "./e2e-packaged",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
