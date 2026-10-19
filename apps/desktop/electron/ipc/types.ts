// Single source of truth for the preload bridge (`window.lucid`). Imported by main, preload and
// the renderer, so it must stay free of Electron and Node imports.
import type { BlockPatch, LucidDoc, LucidFile } from "@lucid/core";
import type { PdfStyle } from "@lucid/kit";

export interface PageSummary {
  id: string;
  title: string;
  updatedAt: string;
  fileName: string;
  /** The note format of the page (a `@lucid/kit` format id); none for a blank page. */
  format?: string;
}
export interface PageProblem {
  fileName: string;
  message: string;
}

/** What the File menu asks of the window. */
export type MenuAction = "export-note" | "import-note";

export interface NoteImportResult {
  /** Notes that are in the library now (a copy when the same note was already there). */
  imported: { id: string; title: string; copy: boolean }[];
  /** Files that could not be used, with the reason in words. Nothing was written for them. */
  problems: { fileName: string; message: string }[];
}

/** What the View menu asks of the page: bigger, smaller, or back to 100%. */
export type PageZoomAction = "in" | "out" | "reset";

export interface PdfRequest {
  pageId: string;
  title: string;
  doc: LucidDoc;
  /** Block id to SVG text for each diagram and chart. */
  figures: Record<string, string>;
  /** The page's note format (a kit format id) and the values for its fields under the title. */
  format?: string | undefined;
  info?: Record<string, string> | undefined;
}
/**
 * How far the PDF engine is, for the window to show. The first PDF on a computer makes Tectonic download the typesetting
 * files it needs (hundreds of small ones, one at a time: minutes, then never again), so the count tells a person it is alive.
 */
export interface PdfProgress {
  /** "warmup" is the preparation after the first start; "pdf" is a page being made. */
  phase: "warmup" | "pdf";
  /** Typesetting files downloaded so far. */
  files: number;
  /** The preparation has ended; `message` says why when it failed. */
  done?: boolean;
  message?: string;
}
export type PdfResult =
  | {
      ok: true;
      pdf: Uint8Array;
      ms: number;
      /** Things the person should know (a tool that is missing). */ warnings: string[];
    }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; message: string; log: string };

/** How LM Studio is doing for the model Lucid is set to use. */
export interface LmStatus {
  /** down: not running. no-model: running, nothing loaded. wrong-model: something else is loaded. ready. */
  state: "down" | "no-model" | "wrong-model" | "ready";
  /** The configured model's key and a name to show. */
  model: string;
  name: string;
  /** Models LM Studio reports as loaded. */
  loaded: string[];
  /** Whether Lucid can load the configured model by itself (the `lms` tool is there and the model is downloaded). */
  canLoad: boolean;
  sizeBytes?: number | undefined;
  /** Why it cannot load, in plain words. */
  problem?: string | undefined;
  /** When LM Studio is not running: whether it is installed here (so the window can offer to open it, or to get it). */
  studioInstalled?: boolean | undefined;
}
export type LmLoadResult = { ok: true } | { ok: false; message: string };

/**
 * Something the main process needs from the open page while an agent works through MCP: which page is open, what it
 * holds right now, or an edit to apply as one undo step. The renderer answers with `AgentReply`.
 */
export type AgentRequest =
  | { id: number; method: "openPage" }
  | { id: number; method: "getDoc" }
  /** Draws the diagrams and charts of a document (Mermaid needs the window) and answers block id to SVG. */
  | { id: number; method: "figures"; params: { doc: LucidDoc } }
  | {
      id: number;
      method: "apply";
      params: { patch: BlockPatch; note: { summary: string; source: string; affected: string[] } };
    };
export type AgentReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** What the renderer may know about the settings, and change (no program paths). */
/** How long a paste waits for more before it is sent by itself, in ms (0: never, press Enter). */
export const AUTO_SEND_MS = [450, 1000, 2000, 0] as const;
export type AutoSendMs = (typeof AUTO_SEND_MS)[number];

export interface PublicSettings {
  author: string;
  footerRight: string;
  /** How PDFs look (paper, text size, typeface, margins, accent, numbering, date). */
  pdf: PdfStyle;
  /** What dictation does with a paste. */
  dictation: { autoSendMs: AutoSendMs };
  vocabulary: string[];
  llm: { baseUrl: string; model: string; contextLength: number };
  ai: AiSettings;
  /** The address comes from the LUCID_LLM_URL environment variable (tests, development) and is not changed here. */
  llmUrlLocked: boolean;
}
export type SettingsInput = Omit<PublicSettings, "llmUrlLocked">;
export type SettingsSaveResult =
  { ok: true; settings: PublicSettings } | { ok: false; problems: string[] };

export const AI_PROVIDER_CATALOG = [
  {
    kind: "lmstudio",
    label: "LM Studio",
    credential: "none",
    customBaseUrl: true,
    cloud: false,
    defaultBaseUrl: "http://127.0.0.1:1234",
  },
  {
    kind: "ollama",
    label: "Ollama",
    credential: "none",
    customBaseUrl: true,
    cloud: false,
    defaultBaseUrl: "http://127.0.0.1:11434",
  },
  {
    kind: "openai",
    label: "OpenAI API",
    credential: "required",
    customBaseUrl: false,
    cloud: true,
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    kind: "anthropic",
    label: "Anthropic API",
    credential: "required",
    customBaseUrl: false,
    cloud: true,
    defaultBaseUrl: "https://api.anthropic.com/v1",
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    credential: "required",
    customBaseUrl: false,
    cloud: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    kind: "ollama-cloud",
    label: "Ollama Cloud",
    credential: "required",
    customBaseUrl: false,
    cloud: true,
    defaultBaseUrl: "https://ollama.com/v1",
  },
  {
    kind: "custom",
    label: "OpenAI-compatible",
    credential: "optional",
    customBaseUrl: true,
    cloud: true,
    defaultBaseUrl: "https://api.example.com/v1",
  },
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_CATALOG)[number]["kind"];
export interface ProviderProfile {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
}
export interface AiSettings {
  defaultProfileId: string;
  profiles: ProviderProfile[];
}
export interface ProviderConnectionResult {
  ok: boolean;
  message: string;
  models?: string[] | undefined;
}

export const providerCredentialId = (profileId: string): string => `provider.${profileId}`;

export interface AiStartRequest {
  id: number;
  /** Resolves to main-process configuration; it is not an endpoint or credential. */
  providerId: string;
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  lane: {
    temperature: number;
    topP: number;
    topK: number;
    presencePenalty: number;
    maxTokens: number;
  };
  jsonSchema?: { name: string; schema: object } | undefined;
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | undefined;
}
export type AiStartResult = { ok: true } | { ok: false; message: string };
export type AiEvent =
  | { id: number; type: "delta"; text: string }
  | {
      id: number;
      type: "complete";
      result: {
        usage: {
          prompt: number;
          completion: number;
          reasoning: number;
          source: "provider" | "estimated";
        };
        characters: { request: number; response: number };
        timings: { sentAt: number; firstTokenAt: number | null; doneAt: number };
        model: string;
        provider: string;
        repairAttempts: number;
      };
    }
  | { id: number; type: "error"; code: string; message: string };

export interface CredentialSaveRequest {
  id: string;
  secret: string;
  /** When secure persistence is unavailable, the result reports session storage instead. */
  persist: boolean;
}
export interface CredentialStatus {
  present: boolean;
  storage: "secure" | "session" | "none";
  securePersistenceAvailable: boolean;
}

/** The PDF template (`lucid.sty`): the person's own, or the one that comes with Lucid. */
export interface TemplateState {
  custom: boolean;
  text: string;
}
export type TemplateSaveResult =
  { ok: true; template: TemplateState } | { ok: false; problems: string[] };

export const IPC = {
  ping: "lucid:ping",
  pagesList: "lucid:pages-list",
  pagesCreate: "lucid:pages-create",
  pagesLoad: "lucid:pages-load",
  pagesSave: "lucid:pages-save",
  pagesTrash: "lucid:pages-trash",
  pdfCompile: "lucid:pdf-compile",
  pdfSave: "lucid:pdf-save",
  pdfOpen: "lucid:pdf-open",
  lmOpenStudio: "lucid:lm-open-studio",
  pdfProgress: "lucid:pdf-progress",
  pdfStatus: "lucid:pdf-status",
  pageZoom: "lucid:page-zoom",
  menuAction: "lucid:menu-action",
  noteExport: "lucid:note-export",
  noteImport: "lucid:note-import",
  fileSaveText: "lucid:file-save-text",
  settingsGet: "lucid:settings-get",
  settingsSave: "lucid:settings-save",
  templateGet: "lucid:template-get",
  templateSave: "lucid:template-save",
  templateReset: "lucid:template-reset",
  lmStatus: "lucid:lm-status",
  lmLoad: "lucid:lm-load",
  agentRequest: "lucid:agent-request",
  agentReply: "lucid:agent-reply",
  pagesChanged: "lucid:pages-changed",
  aiStart: "lucid:ai-start",
  aiAbort: "lucid:ai-abort",
  aiEvent: "lucid:ai-event",
  credentialSave: "lucid:credential-save",
  credentialDelete: "lucid:credential-delete",
  credentialStatus: "lucid:credential-status",
  providerTest: "lucid:provider-test",
  providerModels: "lucid:provider-models",
} as const;

export interface LucidApi {
  /** Round-trip check that the renderer can reach the main process. */
  ping(): Promise<"pong">;
  agent: {
    /** The main process asks the open page for something (an AI agent is working through MCP). Returns a function that stops listening. */
    onRequest(listener: (request: AgentRequest) => void): () => void;
    reply(reply: AgentReply): Promise<void>;
  };
  pages: {
    /** Pages were changed behind the renderer's back (an agent edited one that was not open). */
    onChanged(listener: () => void): () => void;
    list(): Promise<{ pages: PageSummary[]; problems: PageProblem[] }>;
    /** A new page, blank or of a note format (a kit format id). */
    create(title?: string, options?: { format?: string }): Promise<LucidFile>;
    load(id: string): Promise<LucidFile>;
    save(file: LucidFile): Promise<LucidFile>;
    trash(id: string): Promise<void>;
  };
  settings: {
    get(): Promise<PublicSettings>;
    /** Checks and saves; the new values apply at once (the model, the PDF style, new pages). */
    save(input: SettingsInput): Promise<SettingsSaveResult>;
  };
  template: {
    get(): Promise<TemplateState>;
    /** Checks and keeps the text as the PDF template; it is used from the next PDF. */
    save(text: string): Promise<TemplateSaveResult>;
    /** Back to the template that comes with Lucid. */
    reset(): Promise<TemplateState>;
  };
  ai: {
    start(request: AiStartRequest): Promise<AiStartResult>;
    abort(id: number): Promise<void>;
    onEvent(listener: (event: AiEvent) => void): () => void;
  };
  credentials: {
    /** Saves a secret but never returns it. */
    save(request: CredentialSaveRequest): Promise<CredentialStatus>;
    delete(id: string): Promise<void>;
    status(id: string): Promise<CredentialStatus>;
  };
  providers: {
    /** Tests the saved profile. Main resolves its URL and credential by id. */
    test(id: string): Promise<ProviderConnectionResult>;
    /** Returns model ids from the saved profile without exposing credentials. */
    models(id: string): Promise<ProviderConnectionResult>;
  };
  lm: {
    status(): Promise<LmStatus>;
    /** Loads the configured model in LM Studio (after the person agreed), unloading others first. */
    load(): Promise<LmLoadResult>;
    /** Opens LM Studio if it is installed, otherwise the page where it is downloaded. */
    openStudio(): Promise<"opened" | "download">;
  };
  pdf: {
    compile(req: PdfRequest): Promise<PdfResult>;
    /** Ask where to save and write the PDF. Resolves to the saved path, or null if the user cancelled. */
    save(pdf: Uint8Array, suggestedName: string): Promise<string | null>;
    /** Opens a PDF the app just saved in the default viewer. */
    open(path: string): Promise<void>;
    /** Where the engine is (a download of typesetting files, the first time), pushed as it changes. */
    onProgress(listener: (progress: PdfProgress) => void): () => void;
    /** The preparation after the first start, if it is still going (the window may open after it began). */
    status(): Promise<PdfProgress | null>;
  };
  note: {
    /**
     * Asks where to save and writes the note as a `.lucid` file, with what was said and the history unless `history` is
     * false. Resolves to the saved path, or null if the person cancelled.
     */
    export(file: LucidFile, options: { history: boolean }): Promise<string | null>;
    /** Asks for one or more `.lucid` files and brings them in. Null if the person cancelled. */
    import(): Promise<NoteImportResult | null>;
    /** The File menu (Import Note…, Export Note…) asks for the same. */
    onMenu(listener: (action: MenuAction) => void): () => void;
  };
  zoom: {
    /** The View menu (⌘+, ⌘−, ⌘0) asks for the page, and only the page, to be zoomed. */
    onAction(listener: (action: PageZoomAction) => void): () => void;
  };
  file: {
    /** Ask where to save and write a Markdown file. Resolves to the saved path, or null if the user cancelled. */
    saveMarkdown(text: string, suggestedName: string): Promise<string | null>;
  };
}
