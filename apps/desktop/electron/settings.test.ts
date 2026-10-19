import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PDF_STYLE } from "@lucid/kit";
import { SettingsError, loadSettings, saveSettings } from "./settings";

describe("loadSettings", () => {
  it("uses the defaults and writes them out on first run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    const s = await loadSettings(dir);
    // Nothing personal is built in: the name and the footer text of the PDFs are for the person to fill in.
    expect(s).toMatchObject({ author: "", footerRight: "" });
    expect(JSON.parse(await readFile(join(dir, ".lucid", "settings.json"), "utf8"))).toEqual(s);
  });

  it("reads edited values and fills in missing ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(
      join(dir, ".lucid", "settings.json"),
      JSON.stringify({ author: "Asha" }),
      "utf8",
    );
    expect(await loadSettings(dir)).toMatchObject({ author: "Asha", footerRight: "" });
  });

  it("migrates an existing LM Studio address and model into the first provider profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(
      join(dir, ".lucid", "settings.json"),
      JSON.stringify({ llm: { baseUrl: "http://localhost:9876", model: "local/model" } }),
      "utf8",
    );
    expect((await loadSettings(dir)).ai).toEqual({
      defaultProfileId: "lmstudio",
      profiles: [
        {
          id: "lmstudio",
          name: "LM Studio",
          kind: "lmstudio",
          baseUrl: "http://localhost:9876",
          model: "local/model",
        },
      ],
    });
  });

  it("sends a paste after 0.5 s unless the settings say otherwise (a file from before has no such setting)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    await mkdir(join(dir, ".lucid"));
    const file = join(dir, ".lucid", "settings.json");
    await writeFile(file, JSON.stringify({ author: "Asha" }), "utf8");
    expect((await loadSettings(dir)).dictation).toEqual({ autoSendMs: 450 });
    await writeFile(file, JSON.stringify({ dictation: { autoSendMs: 0 } }), "utf8");
    expect((await loadSettings(dir)).dictation).toEqual({ autoSendMs: 0 });
    // A value that is not offered falls back to the defaults, like any damaged setting.
    await writeFile(file, JSON.stringify({ dictation: { autoSendMs: 7 } }), "utf8");
    expect((await loadSettings(dir)).dictation).toEqual({ autoSendMs: 450 });
  });

  it("gives the house style to a settings file from before there were PDF choices, and keeps partial ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    await mkdir(join(dir, ".lucid"));
    const file = join(dir, ".lucid", "settings.json");
    await writeFile(file, JSON.stringify({ author: "Asha" }), "utf8");
    expect((await loadSettings(dir)).pdf).toEqual(DEFAULT_PDF_STYLE);
    await writeFile(file, JSON.stringify({ pdf: { paper: "a4", font: "times" } }), "utf8");
    expect((await loadSettings(dir)).pdf).toEqual({
      ...DEFAULT_PDF_STYLE,
      paper: "a4",
      font: "times",
    });
  });

  it("falls back to the defaults for a damaged file without overwriting it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(join(dir, ".lucid", "settings.json"), "{ nope", "utf8");
    expect(await loadSettings(dir)).toMatchObject({ author: "" });
    expect(await readFile(join(dir, ".lucid", "settings.json"), "utf8")).toBe("{ nope");
  });
});

describe("saveSettings", () => {
  const valid = {
    author: "Asha",
    footerRight: "Notes",
    pdf: { ...DEFAULT_PDF_STYLE, paper: "a4", fontSize: 11, accent: "navy", showDate: false },
    dictation: { autoSendMs: 1000 },
    vocabulary: ["vLLM", "Kafka", "vLLM"],
    llm: { baseUrl: "http://localhost:1234/", model: "other/model-7b", contextLength: 16384 },
    ai: {
      defaultProfileId: "lmstudio",
      profiles: [
        {
          id: "lmstudio",
          name: "Local",
          kind: "lmstudio",
          baseUrl: "http://localhost:1234",
          model: "other/model-7b",
        },
      ],
    },
  };

  it("writes the new values, keeps program paths and everything else, and tidies the address and the words", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    await mkdir(join(dir, ".lucid"));
    await writeFile(
      join(dir, ".lucid", "settings.json"),
      JSON.stringify({ tectonicPath: "/custom/tectonic", llm: { lmsPath: "/custom/lms" } }),
      "utf8",
    );
    const saved = await saveSettings(dir, valid);
    expect(saved).toMatchObject({
      author: "Asha",
      footerRight: "Notes",
      pdf: { paper: "a4", fontSize: 11, accent: "navy", showDate: false },
      dictation: { autoSendMs: 1000 },
      vocabulary: ["vLLM", "Kafka"],
      tectonicPath: "/custom/tectonic",
      llm: {
        baseUrl: "http://localhost:1234",
        model: "other/model-7b",
        contextLength: 16384,
        lmsPath: "/custom/lms",
      },
      ai: valid.ai,
    });
    expect(JSON.parse(await readFile(join(dir, ".lucid", "settings.json"), "utf8"))).toEqual(saved);
    expect(await loadSettings(dir)).toEqual(saved);
  });

  it("refuses an address that is not on this computer, a model name that is not a name, odd sizes and empty names, writing nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lucid-set-"));
    const before = await loadSettings(dir);
    const bad = async (over: Record<string, unknown>) =>
      saveSettings(dir, { ...valid, ...over }).catch((e: unknown) => e);
    const remote = await bad({ llm: { ...valid.llm, baseUrl: "http://example.com:1234" } });
    expect(remote).toBeInstanceOf(SettingsError);
    expect((remote as SettingsError).problems.join(" ")).toContain("on this computer");
    expect(
      await bad({ llm: { ...valid.llm, baseUrl: "http://127.0.0.1:1234/v1" } }),
    ).toBeInstanceOf(SettingsError);
    expect(await bad({ llm: { ...valid.llm, baseUrl: "https://127.0.0.1:1234" } })).toBeInstanceOf(
      SettingsError,
    );
    expect(await bad({ llm: { ...valid.llm, model: "x; rm -rf /" } })).toBeInstanceOf(
      SettingsError,
    );
    expect(await bad({ llm: { ...valid.llm, contextLength: 100 } })).toBeInstanceOf(SettingsError);
    expect(await bad({ author: "x".repeat(81) })).toBeInstanceOf(SettingsError);
    expect(await bad({ author: "two\nlines" })).toBeInstanceOf(SettingsError);
    expect(await bad({ footerRight: "x".repeat(41) })).toBeInstanceOf(SettingsError);
    expect(
      await bad({ vocabulary: Array.from({ length: 201 }, (_, i) => `w${String(i)}`) }),
    ).toBeInstanceOf(SettingsError);
    expect(await bad({ tectonicPath: "/bin/sh" })).toBeInstanceOf(SettingsError);
    expect(await bad({ pdf: { ...DEFAULT_PDF_STYLE, fontSize: 14 } })).toBeInstanceOf(
      SettingsError,
    );
    expect(await bad({ pdf: { ...DEFAULT_PDF_STYLE, font: "comic-sans" } })).toBeInstanceOf(
      SettingsError,
    );
    expect(await bad({ pdf: { ...DEFAULT_PDF_STYLE, template: "/etc/passwd" } })).toBeInstanceOf(
      SettingsError,
    );
    expect(await bad({ pdf: undefined })).toBeInstanceOf(SettingsError);
    expect(await bad({ dictation: { autoSendMs: 300 } })).toBeInstanceOf(SettingsError);
    expect(await bad({ dictation: undefined })).toBeInstanceOf(SettingsError);
    expect(
      await bad({
        ai: {
          defaultProfileId: "missing",
          profiles: valid.ai.profiles,
        },
      }),
    ).toBeInstanceOf(SettingsError);
    expect(
      await bad({
        ai: {
          defaultProfileId: "lmstudio",
          profiles: [
            {
              ...valid.ai.profiles[0],
              baseUrl: "https://lm-studio.example.com",
            },
          ],
        },
      }),
    ).toBeInstanceOf(SettingsError);
    expect(
      await bad({
        ai: {
          defaultProfileId: "ollama",
          profiles: [
            {
              id: "ollama",
              name: "Ollama",
              kind: "ollama",
              baseUrl: "http://127.0.0.1:11434",
              model: "remote:cloud",
            },
          ],
        },
      }),
    ).toBeInstanceOf(SettingsError);
    expect(
      await bad({
        ai: {
          defaultProfileId: "openai",
          profiles: [
            {
              id: "openai",
              name: "OpenAI",
              kind: "openai",
              baseUrl: "https://example.com/v1",
              model: "gpt-4.1-mini",
            },
          ],
        },
      }),
    ).toBeInstanceOf(SettingsError);
    expect(await loadSettings(dir)).toEqual(before);
  });
});
