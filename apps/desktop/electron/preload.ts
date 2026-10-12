import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC,
  type AgentReply,
  type AgentRequest,
  type LlmEvent,
  type LmLoadResult,
  type LmStatus,
  type LucidApi,
  type MenuAction,
  type NoteImportResult,
  type PdfProgress,
  type PageZoomAction,
} from "./ipc/types";

const api: LucidApi = {
  ping: () => ipcRenderer.invoke(IPC.ping) as Promise<"pong">,
  agent: {
    onRequest: (listener) => {
      const handler = (_event: IpcRendererEvent, request: AgentRequest) => {
        listener(request);
      };
      ipcRenderer.on(IPC.agentRequest, handler);
      return () => {
        ipcRenderer.removeListener(IPC.agentRequest, handler);
      };
    },
    reply: (reply: AgentReply) => ipcRenderer.invoke(IPC.agentReply, reply) as Promise<void>,
  },
  pages: {
    onChanged: (listener) => {
      const handler = () => {
        listener();
      };
      ipcRenderer.on(IPC.pagesChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.pagesChanged, handler);
      };
    },
    list: () => ipcRenderer.invoke(IPC.pagesList) as ReturnType<LucidApi["pages"]["list"]>,
    create: (title, options) =>
      ipcRenderer.invoke(IPC.pagesCreate, title, options) as ReturnType<
        LucidApi["pages"]["create"]
      >,
    load: (id) => ipcRenderer.invoke(IPC.pagesLoad, id) as ReturnType<LucidApi["pages"]["load"]>,
    save: (file) =>
      ipcRenderer.invoke(IPC.pagesSave, file) as ReturnType<LucidApi["pages"]["save"]>,
    trash: (id) => ipcRenderer.invoke(IPC.pagesTrash, id) as Promise<void>,
  },
  note: {
    export: (file, options) =>
      ipcRenderer.invoke(IPC.noteExport, file, options) as Promise<string | null>,
    import: () => ipcRenderer.invoke(IPC.noteImport) as Promise<NoteImportResult | null>,
    onMenu: (listener) => {
      const handler = (_e: IpcRendererEvent, action: MenuAction) => {
        listener(action);
      };
      ipcRenderer.on(IPC.menuAction, handler);
      return () => {
        ipcRenderer.removeListener(IPC.menuAction, handler);
      };
    },
  },
  zoom: {
    onAction: (listener) => {
      const handler = (_e: IpcRendererEvent, action: PageZoomAction) => {
        listener(action);
      };
      ipcRenderer.on(IPC.pageZoom, handler);
      return () => {
        ipcRenderer.removeListener(IPC.pageZoom, handler);
      };
    },
  },
  template: {
    get: () => ipcRenderer.invoke(IPC.templateGet) as ReturnType<LucidApi["template"]["get"]>,
    save: (text) =>
      ipcRenderer.invoke(IPC.templateSave, text) as ReturnType<LucidApi["template"]["save"]>,
    reset: () => ipcRenderer.invoke(IPC.templateReset) as ReturnType<LucidApi["template"]["reset"]>,
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as ReturnType<LucidApi["settings"]["get"]>,
    save: (input) =>
      ipcRenderer.invoke(IPC.settingsSave, input) as ReturnType<LucidApi["settings"]["save"]>,
  },
  llm: {
    start: (req) => ipcRenderer.invoke(IPC.llmStart, req) as ReturnType<LucidApi["llm"]["start"]>,
    abort: (id) => ipcRenderer.invoke(IPC.llmAbort, id) as Promise<void>,
    onEvent: (listener) => {
      const handler = (_e: IpcRendererEvent, event: LlmEvent) => {
        listener(event);
      };
      ipcRenderer.on(IPC.llmEvent, handler);
      return () => {
        ipcRenderer.removeListener(IPC.llmEvent, handler);
      };
    },
  },
  lm: {
    status: () => ipcRenderer.invoke(IPC.lmStatus) as Promise<LmStatus>,
    load: () => ipcRenderer.invoke(IPC.lmLoad) as Promise<LmLoadResult>,
    openStudio: () => ipcRenderer.invoke(IPC.lmOpenStudio) as Promise<"opened" | "download">,
  },
  pdf: {
    compile: (req) =>
      ipcRenderer.invoke(IPC.pdfCompile, req) as ReturnType<LucidApi["pdf"]["compile"]>,
    save: (pdf, suggestedName) =>
      ipcRenderer.invoke(IPC.pdfSave, pdf, suggestedName) as Promise<string | null>,
    open: (path) => ipcRenderer.invoke(IPC.pdfOpen, path) as Promise<void>,
    onProgress: (listener) => {
      const handler = (_e: IpcRendererEvent, progress: PdfProgress) => {
        listener(progress);
      };
      ipcRenderer.on(IPC.pdfProgress, handler);
      return () => {
        ipcRenderer.removeListener(IPC.pdfProgress, handler);
      };
    },
    status: () => ipcRenderer.invoke(IPC.pdfStatus) as Promise<PdfProgress | null>,
  },
  file: {
    saveMarkdown: (text, suggestedName) =>
      ipcRenderer.invoke(IPC.fileSaveText, text, suggestedName) as Promise<string | null>,
  },
};

contextBridge.exposeInMainWorld("lucid", api);
