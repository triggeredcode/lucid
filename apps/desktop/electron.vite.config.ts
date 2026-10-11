import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Everything the app needs is bundled into out/ (only Electron and Node itself stay outside), so the packaged app carries no
// node_modules: the workspace packages ship TypeScript source, and the other libraries are small.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(__dirname, "electron/main.ts") } },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(__dirname, "electron/preload.ts") } },
    },
  },
  renderer: {
    root: resolve(__dirname, "src"),
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, "src/index.html") } } },
  },
});
