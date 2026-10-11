import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Dependency rule: which internal packages each package may import.
const ALLOWED = {
  core: [],
  kit: ["core"],
  // mock-lmstudio is imported by llm tests only (the client is tested against the fake server).
  llm: ["core", "kit", "mock-lmstudio"],
  mcp: ["core", "kit"],
  "mock-lmstudio": [],
  evals: ["core", "kit", "llm", "mock-lmstudio"],
};
const ALL = Object.keys(ALLOWED);

const dependencyRules = ALL.map((pkg) => {
  const forbidden = ALL.filter((p) => p !== pkg && !ALLOWED[pkg].includes(p));
  return {
    files: [`packages/${pkg}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: forbidden.map((p) => ({
            group: [`@lucid/${p}`, `@lucid/${p}/*`],
            message: `packages/${pkg} must not import @lucid/${p}.`,
          })),
        },
      ],
    },
  };
});

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/out/**", "**/node_modules/**", "**/coverage/**", "**/release/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((c) => ({ ...c, files: ["**/*.{ts,tsx}"] })),
  // Build scripts run in Node.
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        URL: "readonly",
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
      },
    },
  },
  // electron-builder hooks are CommonJS.
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        exports: "writable",
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // `const { seq: _seq, ...rest } = edge` is the idiomatic way to omit a property.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      // Numbers and booleans in template strings are fine and common in logs and reports.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  // packages/core is pure: no DOM, Electron or network, on top of the dependency rule.
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", "window", "document", "fetch", "localStorage"],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lucid/*"],
              message: "packages/core must not import other @lucid packages.",
            },
            {
              group: [
                "electron",
                "fs",
                "http",
                "https",
                "net",
                "node:fs",
                "node:http",
                "node:https",
                "node:net",
              ],
              message: "packages/core must stay pure (no I/O).",
            },
          ],
        },
      ],
    },
  },
  ...dependencyRules.filter((r) => !r.files[0].startsWith("packages/core/")),
  prettier,
);
