import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PDF_STYLE, PdfStyleSchema } from "@lucid/kit";
import {
  AI_PROVIDER_CATALOG,
  AUTO_SEND_MS,
  type AiProviderKind,
  type AiSettings,
} from "./ipc/types";
import { validateProviderEndpoint } from "./ai/security";
import { z } from "zod";

const AutoSendMsSchema = z.union([
  z.literal(AUTO_SEND_MS[0]),
  z.literal(AUTO_SEND_MS[1]),
  z.literal(AUTO_SEND_MS[2]),
  z.literal(AUTO_SEND_MS[3]),
]);

const defaultAiSettings = (llm?: { baseUrl?: string; model?: string }): AiSettings => ({
  defaultProfileId: "lmstudio",
  profiles: [
    {
      id: "lmstudio",
      name: "LM Studio",
      kind: "lmstudio",
      baseUrl: llm?.baseUrl ?? "http://127.0.0.1:1234",
      model: llm?.model ?? "qwen/qwen3.8-27b",
    },
  ],
});

const ProviderKindSchema = z.enum(
  AI_PROVIDER_CATALOG.map((provider) => provider.kind) as [AiProviderKind, ...AiProviderKind[]],
);
const ProviderProfileSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i, "must contain only letters, numbers, dots or dashes"),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\r\n]*$/, "must be one line"),
  kind: ProviderKindSchema,
  baseUrl: z
    .string()
    .trim()
    .transform((value, ctx) => {
      try {
        return validateProviderEndpoint(value).href.replace(/\/+$/, "");
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "must be a valid provider address",
        });
        return z.NEVER;
      }
    }),
  model: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^[^\r\n]*$/, "must be one line"),
});
const LOCAL_PROVIDER_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const AiSettingsSchema = z
  .strictObject({
    defaultProfileId: z.string().trim(),
    profiles: z.array(ProviderProfileSchema).min(1).max(20),
  })
  .superRefine((settings, ctx) => {
    const ids = new Set<string>();
    for (const [index, profile] of settings.profiles.entries()) {
      if (ids.has(profile.id))
        ctx.addIssue({
          code: "custom",
          path: ["profiles", index, "id"],
          message: "must be unique",
        });
      ids.add(profile.id);
      const provider = AI_PROVIDER_CATALOG.find((candidate) => candidate.kind === profile.kind);
      if (provider && !provider.cloud) {
        const url = new URL(profile.baseUrl);
        if (url.protocol !== "http:" || !LOCAL_PROVIDER_HOSTS.has(url.hostname))
          ctx.addIssue({
            code: "custom",
            path: ["profiles", index, "baseUrl"],
            message: `${provider.label} must use an address on this computer`,
          });
      }
      if (
        provider &&
        !provider.customBaseUrl &&
        profile.baseUrl !== provider.defaultBaseUrl.replace(/\/+$/, "")
      )
        ctx.addIssue({
          code: "custom",
          path: ["profiles", index, "baseUrl"],
          message: `is fixed for ${provider.label}`,
        });
    }
    if (!ids.has(settings.defaultProfileId))
      ctx.addIssue({
        code: "custom",
        path: ["defaultProfileId"],
        message: "must name one of the provider profiles",
      });
  });

/** User settings in `<library>/.lucid/settings.json`. Missing file or fields fall back to the defaults. */
export const SettingsSchema = z.object({
  /** Your name under the title of exported PDFs (optional). */
  author: z.string().default(""),
  /** Right-hand footer text of exported PDFs (optional; the page number is on the left). */
  footerRight: z.string().default(""),
  /** How PDFs look: paper, text size, typeface, margins, accent, numbering and date (the house style by default). */
  pdf: PdfStyleSchema.default(DEFAULT_PDF_STYLE),
  /** Dictation: how long a paste waits for more before it is sent by itself (0: never, press Enter). */
  dictation: z.object({ autoSendMs: AutoSendMsSchema.default(450) }).default({ autoSendMs: 450 }),
  /** Words speech recognition tends to get wrong (names, tools); kept as spoken when the notes are written. */
  vocabulary: z.array(z.string()).default([]),
  /** The Tectonic to run; empty means the one that comes with Lucid, or an installed one. */
  tectonicPath: z.string().default(""),
  llm: z
    .object({
      baseUrl: z.string().default("http://127.0.0.1:1234"),
      model: z.string().default("qwen/qwen3.8-27b"),
      /** Context length when Lucid loads the model for you (one request at a time: `--parallel 1`). */
      contextLength: z.number().int().min(2048).max(262144).default(32768),
      /** The `lms` command line tool of LM Studio; empty means ~/.lmstudio/bin/lms. */
      lmsPath: z.string().default(""),
    })
    .default({
      baseUrl: "http://127.0.0.1:1234",
      model: "qwen/qwen3.8-27b",
      contextLength: 32768,
      lmsPath: "",
    }),
  ai: AiSettingsSchema.default(defaultAiSettings()),
});
export type Settings = z.infer<typeof SettingsSchema>;

export async function loadSettings(libraryDir: string): Promise<Settings> {
  const file = join(libraryDir, ".lucid", "settings.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    // First run: use the defaults and write them out so they can be edited.
    const defaults = SettingsSchema.parse({});
    await mkdir(join(libraryDir, ".lucid"), { recursive: true });
    await writeFile(file, `${JSON.stringify(defaults, null, 2)}\n`, "utf8").catch(() => undefined);
    return defaults;
  }
  try {
    const source = JSON.parse(text) as { ai?: unknown; llm?: { baseUrl?: string; model?: string } };
    const parsed = SettingsSchema.safeParse({
      ...source,
      ai: source.ai ?? defaultAiSettings(source.llm),
    });
    return parsed.success ? parsed.data : SettingsSchema.parse({});
  } catch {
    return SettingsSchema.parse({});
  }
}

// ----------------------------------------------------------------------------------------------- editing

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\r\n]*$/, "must be one line");

/** The LM Studio address: only this computer, only http, no path (Lucid adds /v1/...). */
const LocalAddress = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname)) throw new Error("not local");
      if (url.pathname !== "/" || url.search || url.hash) throw new Error("has a path");
      return `${url.protocol}//${url.host}`;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "must be an address on this computer, like http://127.0.0.1:1234",
      });
      return z.NEVER;
    }
  });

/** What the Settings window may change: no program paths (a window must not choose which programs the app runs). */
export const EditableSettingsSchema = z.strictObject({
  author: oneLine(80),
  footerRight: oneLine(40),
  pdf: PdfStyleSchema,
  dictation: z.strictObject({ autoSendMs: AutoSendMsSchema }),
  vocabulary: z.array(oneLine(60).min(1)).max(200, "at most 200 words"),
  llm: z.strictObject({
    baseUrl: LocalAddress,
    model: z
      .string()
      .trim()
      .regex(/^[\w][\w./@:+-]{0,200}$/, "must be a model name like qwen/qwen3.8-27b"),
    contextLength: z.number().int().min(2048).max(262144),
  }),
  ai: AiSettingsSchema,
});
export type EditableSettings = z.infer<typeof EditableSettingsSchema>;

export class SettingsError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "SettingsError";
  }
}

/** Checks the new values and writes them (program paths and everything else stay as they are). Atomic: a failure changes nothing. */
export async function saveSettings(libraryDir: string, input: unknown): Promise<Settings> {
  const parsed = EditableSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new SettingsError(
      parsed.error.issues.map((i) => `${i.path.join(" ") || "settings"} ${i.message}`),
    );
  }
  const current = await loadSettings(libraryDir);
  const next: Settings = {
    ...current,
    author: parsed.data.author,
    footerRight: parsed.data.footerRight,
    pdf: parsed.data.pdf,
    dictation: parsed.data.dictation,
    vocabulary: [...new Set(parsed.data.vocabulary)],
    llm: { ...current.llm, ...parsed.data.llm },
    ai: parsed.data.ai,
  };
  const defaultProfile = next.ai.profiles.find(
    (profile) => profile.id === next.ai.defaultProfileId,
  );
  if (defaultProfile?.kind === "lmstudio") {
    next.llm.baseUrl = defaultProfile.baseUrl;
    next.llm.model = defaultProfile.model;
  }
  const dir = join(libraryDir, ".lucid");
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `settings.json.${String(process.pid)}.tmp`);
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmp, join(dir, "settings.json"));
  return next;
}
