import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// One vitest project per workspace package/app, discovered from the directories so new
// packages are picked up automatically. `extends: true` shares the root options below.
const projects = ["packages", "apps"].flatMap((group) =>
  existsSync(group)
    ? readdirSync(group)
        .filter((dir) => existsSync(join(group, dir, "package.json")))
        .map((dir) => {
          const pkg = JSON.parse(readFileSync(join(group, dir, "package.json"), "utf8")) as {
            name: string;
          };
          return { extends: true, test: { name: pkg.name, root: join(group, dir) } };
        })
    : [],
);

export default defineConfig({
  test: {
    projects,
    // Playwright specs (*.spec.ts) are run by `pnpm e2e`, not vitest.
    include: ["**/*.test.{ts,tsx}"],
    // tsc -b emits compiled tests into dist/; never run those.
    exclude: [...configDefaults.exclude, "**/dist/**", "**/out/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      include: ["packages/core/src/**", "packages/kit/src/**", "packages/llm/src/**"],
    },
  },
});
