/// <reference types="vite/client" />

import type { LucidApi } from "../electron/ipc/types";

declare global {
  interface Window {
    lucid: LucidApi;
  }
}
