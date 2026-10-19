import {
  PatchError,
  newId,
  type Block,
  type BlockPatch,
  type ChangeEntry,
  type DocumentContextIndex,
  type IdGenerator,
  type LucidDoc,
  type TranscriptEntry,
} from "@lucid/core";
import {
  isLlmError,
  runCommand,
  runInput,
  unprocessedPatch,
  type CommandOutcome,
  type AiClient,
  type Lane,
  type LlmError,
} from "@lucid/llm";
import { describeBlocks, humanizeRefs } from "./describe";

export type Mode = "input" | "command";

export interface Utterance {
  id: string;
  text: string;
  source: "wispr" | "whisper" | "typed";
  mode: Mode;
  createdAt: string;
}

/** What the dictation bar shows. */
export type JobStatus =
  | { kind: "idle" }
  | { kind: "working"; startedAt: number; queued: number; mode: Mode }
  | { kind: "waiting"; reason: string }
  | { kind: "done"; summary: string; notice?: string | undefined; at: number; undoable: boolean }
  /** A change that throws something away: waits for yes or no. */
  | { kind: "proposal"; summary: string; reasons: string[] }
  /** The model needs to know which one. */
  | { kind: "clarify"; question: string; options: { label: string; ref: string | null }[] }
  /** A Command Mode utterance that was really notes. */
  | { kind: "content"; text: string }
  /** Command is disabled because the selected provider cannot meet the checked-operations contract. */
  | { kind: "unavailable"; message: string }
  | { kind: "failed"; message: string; text: string };

/** The open page's editor, as the queue needs it. */
export interface EditorPort {
  getDoc(): LucidDoc;
  getContextIndex?(): DocumentContextIndex;
  cursorBlockId(): string | undefined;
  apply(patch: BlockPatch): LucidDoc;
}

export interface QueueOptions {
  client: AiClient;
  lanes: { input: Lane; command: Lane };
  /** Shown when the model is not loaded. */
  modelName: string;
  editor: () => EditorPort | undefined;
  title: () => string;
  vocabulary?: () => string[];
  /** The page's note format (a kit format id), if it has one: the model is told its sections. */
  format?: () => string | undefined;
  onStatus: (status: JobStatus) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onChange: (entry: ChangeEntry) => void;
  /** Timing of every model call (for the developer console and, later, the job log). */
  onCall?: (call: CallInfo) => void;
  /** How often to look for LM Studio again while it is down. */
  pollMs?: number;
  ids?: IdGenerator;
  now?: () => number;
}

interface Job {
  utterances: Utterance[];
  mode: Mode;
  /** What the model is told, when it differs from what was said (an answer to a question was added). */
  text?: string;
}

type Pending =
  | { kind: "proposal"; job: Job; outcome: Extract<CommandOutcome, { kind: "proposal" }> }
  | {
      kind: "clarify";
      job: Job;
      question: string;
      options: { label: string; ref: string | null }[];
    }
  | { kind: "content"; job: Job };

export interface CallInfo {
  mode: Mode;
  promptTokens: number;
  completionTokens: number;
  /** Milliseconds from sending the request to the first token of the answer. */
  firstTokenMs: number | null;
  totalMs: number;
}

class Cancelled extends Error {}

const joined = (job: Job): string => job.text ?? job.utterances.map((u) => u.text).join("\n");

/**
 * One job at a time, in the order they were spoken. Input utterances waiting behind a running job are joined into
 * one, so a burst of dictation becomes one set of notes. Nothing the user says is ever dropped: if the model fails
 * on notes, their words go into the page as they are. Destructive or ambiguous commands wait for the user.
 */
export class JobQueue {
  private waiting: Job[] = [];
  private busy = false;
  private controller: AbortController | undefined;
  private recent: { mode: Mode; text: string }[] = [];
  private touched: { blockId: string; note: string }[] = [];
  private lastFailed: Job | undefined;
  private pending: Pending | undefined;

  constructor(private options: QueueOptions) {}

  /** Another model or address was saved in Settings: the next request uses it (one already running finishes as it was). */
  setModel(model: Pick<QueueOptions, "client" | "lanes" | "modelName">): void {
    this.options = { ...this.options, ...model };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private working(mode: Mode): void {
    this.options.onStatus({
      kind: "working",
      startedAt: this.now(),
      queued: this.waiting.length,
      mode,
    });
  }

  submit(utterance: Utterance): void {
    this.dropPending();
    const last = this.waiting.at(-1);
    if (last && last.mode === "input" && utterance.mode === "input" && last.text === undefined) {
      last.utterances.push(utterance);
    } else this.waiting.push({ utterances: [utterance], mode: utterance.mode });
    this.lastFailed = undefined;
    if (this.busy) this.working(utterance.mode);
    void this.pump();
  }

  /** Stops the running job (and forgets the ones behind it). Their words are not added to the page. */
  cancel(): void {
    this.waiting = [];
    this.controller?.abort();
    if (this.pending) {
      this.dropPending();
      this.options.onStatus({ kind: "idle" });
    }
  }

  /** Runs the job that last failed again (for example after LM Studio loaded the model). */
  retry(): void {
    const job = this.lastFailed;
    if (!job) return;
    this.lastFailed = undefined;
    this.waiting.unshift(job);
    void this.pump();
  }

  /** What the voice meta-commands need to know. */
  get interaction(): { proposal: boolean; clarify: boolean; running: boolean } {
    return {
      proposal: this.pending?.kind === "proposal",
      clarify: this.pending?.kind === "clarify",
      running: this.busy,
    };
  }

  get pendingCount(): number {
    return this.waiting.length + (this.busy ? 1 : 0);
  }

  /** The user said yes to a proposal. */
  accept(): void {
    const p = this.pending;
    if (p?.kind !== "proposal") return;
    this.pending = undefined;
    const editor = this.options.editor();
    if (!editor) return;
    try {
      editor.apply(p.outcome.patch);
    } catch (error) {
      if (error instanceof PatchError) {
        this.log(p.job, "failed");
        this.options.onStatus({
          kind: "failed",
          message: "The page changed while you were deciding. Say it again.",
          text: joined(p.job),
        });
        return;
      }
      throw error;
    }
    this.finish(
      p.job,
      "applied",
      p.outcome.summary,
      undefined,
      p.outcome.affected,
      "command",
      undefined,
      p.outcome.execution === "deterministic" ? "deterministic" : "local-model",
    );
  }

  /** The user said no. */
  reject(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = undefined;
    this.log(p.job, "rejected");
    this.options.onStatus({ kind: "idle" });
  }

  /** The user picked option `n` (1-based) of a question. The command runs again with the answer. */
  choose(n: number): void {
    const p = this.pending;
    if (p?.kind !== "clarify") return;
    const option = p.options[n - 1];
    if (!option) return;
    this.pending = undefined;
    const answer = `${joined(p.job)} (I mean: ${option.label}${option.ref ? `, ${option.ref}` : ""})`;
    this.waiting.unshift({ ...p.job, text: answer });
    void this.pump();
  }

  /** A command that was really notes: add it as notes. */
  insertAsContent(): void {
    const p = this.pending;
    if (p?.kind !== "content") return;
    this.pending = undefined;
    const utterances = p.job.utterances.map((u) => ({ ...u, mode: "input" as const }));
    this.waiting.unshift({ utterances, mode: "input" });
    void this.pump();
  }

  private report(
    mode: Mode,
    calls: readonly {
      usage: { prompt: number; completion: number };
      timings: { sentAt: number; firstTokenAt: number | null; doneAt: number };
    }[],
  ): void {
    for (const c of calls) {
      this.options.onCall?.({
        mode,
        promptTokens: c.usage.prompt,
        completionTokens: c.usage.completion,
        firstTokenMs:
          c.timings.firstTokenAt === null ? null : c.timings.firstTokenAt - c.timings.sentAt,
        totalMs: c.timings.doneAt - c.timings.sentAt,
      });
    }
  }

  private dropPending(): void {
    if (!this.pending) return;
    this.log(this.pending.job, "rejected");
    this.pending = undefined;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.waiting.shift(); job; job = this.waiting.shift()) {
        await this.process(job);
      }
    } finally {
      this.busy = false;
    }
  }

  private log(job: Job, status: TranscriptEntry["status"]): void {
    for (const u of job.utterances) {
      this.options.onTranscript({
        id: u.id,
        text: u.text,
        source: u.source,
        mode: job.mode,
        createdAt: u.createdAt,
        status,
      });
    }
  }

  private async process(job: Job): Promise<void> {
    this.working(job.mode);
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (let attempt = 0; ; attempt++) {
        const editor = this.options.editor();
        if (!editor) throw new Error("There is no open page.");
        try {
          if (job.mode === "input") await this.input(job, editor, controller.signal);
          else await this.command(job, editor, controller.signal);
          return;
        } catch (error) {
          // The page changed under the job (the user edited a block it needed): look at the page again, once.
          if (error instanceof PatchError && attempt === 0) continue;
          throw error;
        }
      }
    } catch (error) {
      this.fail(job, error);
    } finally {
      this.controller = undefined;
    }
  }

  private async input(job: Job, editor: EditorPort, signal: AbortSignal): Promise<void> {
    const text = joined(job);
    const doc = editor.getDoc();
    const cursor = editor.cursorBlockId();
    const outcome = await this.withServer(
      () =>
        runInput(
          {
            doc,
            contextIndex: editor.getContextIndex?.(),
            utterance: text,
            cursorBlockId: cursor,
            title: this.options.title(),
            recent: this.recent,
            vocabulary: this.options.vocabulary?.() ?? [],
            format: this.options.format?.(),
          },
          {
            client: this.options.client,
            lane: this.options.lanes.input,
            signal,
            ids: this.options.ids,
          },
        ),
      signal,
      "input",
    );
    this.report("input", outcome.calls);
    if (outcome.kind === "command") {
      // The model thinks this was an instruction. Notes are never run as commands by themselves: keep the words.
      editor.apply(unprocessedPatch(doc, text, cursor, this.options.ids));
      this.finish(
        job,
        "unprocessed",
        "a note",
        "That sounded like an instruction. Switch to Command mode to edit the page. I added your words as a note.",
        undefined,
        "input",
      );
      return;
    }
    const blocks: Block[] =
      outcome.kind === "applied" ? outcome.blocks : patchBlocks(outcome.patch);
    editor.apply(outcome.patch);
    const notice =
      outcome.kind === "unprocessed"
        ? "I couldn't structure that, so I added your words as they are."
        : outcome.warnings.length > 0
          ? "Some details may not match what you said. Check the notes."
          : undefined;
    this.finish(
      job,
      outcome.kind === "applied" ? "applied" : "unprocessed",
      `Added ${describeBlocks(blocks)}`,
      notice,
      blocks.map((b) => b.id),
      "input",
      text,
    );
  }

  private async command(job: Job, editor: EditorPort, signal: AbortSignal): Promise<void> {
    const text = joined(job);
    const doc = editor.getDoc();
    const outcome = await this.withServer(
      () =>
        runCommand(
          {
            doc,
            contextIndex: editor.getContextIndex?.(),
            utterance: text,
            cursorBlockId: editor.cursorBlockId(),
            title: this.options.title(),
            touched: this.touched,
            recent: this.recent,
            vocabulary: this.options.vocabulary?.() ?? [],
            format: this.options.format?.(),
          },
          {
            client: this.options.client,
            lane: this.options.lanes.command,
            signal,
            ids: this.options.ids,
          },
        ),
      signal,
      "command",
    );
    this.report("command", outcome.calls);
    switch (outcome.kind) {
      case "unavailable":
        this.log(job, "rejected");
        this.options.onStatus({ kind: "unavailable", message: outcome.message });
        return;
      case "edit": {
        editor.apply(outcome.patch);
        const notice = outcome.warnings.length > 0 ? outcome.warnings.join(" ") : undefined;
        this.finish(
          job,
          "applied",
          outcome.summary,
          notice,
          outcome.affected,
          "command",
          undefined,
          outcome.execution === "deterministic" ? "deterministic" : "local-model",
        );
        return;
      }
      case "proposal":
        this.pending = { kind: "proposal", job, outcome };
        this.options.onStatus({
          kind: "proposal",
          summary: outcome.summary,
          reasons: outcome.destructive.map((d) => humanizeRefs(d.reason, doc)),
        });
        return;
      case "clarify":
        this.pending = {
          kind: "clarify",
          job,
          question: outcome.question,
          options: outcome.options,
        };
        this.options.onStatus({
          kind: "clarify",
          question: outcome.question,
          options: outcome.options,
        });
        return;
      case "none":
        if (outcome.content) {
          this.pending = { kind: "content", job };
          this.options.onStatus({ kind: "content", text });
        } else {
          this.log(job, "rejected");
          this.options.onStatus({
            kind: "done",
            summary: "No change",
            notice: outcome.reason,
            at: this.now(),
            undoable: false,
          });
        }
        return;
      case "failed":
        this.lastFailed = job;
        this.log(job, "failed");
        this.options.onStatus({
          kind: "failed",
          message: `I couldn't work out how to do that. ${outcome.message}`,
          text,
        });
        return;
    }
  }

  /**
   * Runs a model call. While LM Studio is down, waits for it and tries again. A call that stalls or drops mid-answer is
   * tried once more before the user hears about it (LM Studio now and then needs a second go after switching prompts).
   */
  private async withServer<T>(call: () => Promise<T>, signal: AbortSignal, mode: Mode): Promise<T> {
    let retried = false;
    for (;;) {
      try {
        return await call();
      } catch (error) {
        if (isLlmError(error) && error.code === "LmUnreachable") {
          this.options.onStatus({ kind: "waiting", reason: "Waiting for LM Studio…" });
          await this.waitForServer(signal);
          this.working(mode);
          continue;
        }
        if (
          isLlmError(error) &&
          (error.code === "FirstTokenTimeout" || error.code === "ConnectionLost") &&
          !retried
        ) {
          retried = true;
          this.working(mode);
          continue;
        }
        if (isLlmError(error) && error.code === "Aborted") throw new Cancelled();
        throw error;
      }
    }
  }

  private async waitForServer(signal: AbortSignal): Promise<void> {
    const pollMs = this.options.pollMs ?? 3000;
    while (!signal.aborted) {
      const health = await this.options.client.health(signal);
      if (health.reachable) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    throw new Cancelled();
  }

  private finish(
    job: Job,
    status: TranscriptEntry["status"],
    summary: string,
    notice: string | undefined,
    affected: readonly string[] | undefined,
    mode: Mode,
    recentText?: string,
    source = "local-model",
  ): void {
    this.log(job, status);
    this.recent = [...this.recent, { mode, text: recentText ?? joined(job) }].slice(-3);
    for (const id of (affected ?? []).slice(0, 3).reverse())
      this.touched.unshift({ blockId: id, note: summary.toLowerCase() });
    this.touched = this.touched.slice(0, 6);
    const at = this.now();
    this.options.onChange({
      id: job.utterances[0]?.id ?? (this.options.ids ?? newId)(),
      at: new Date(at).toISOString(),
      summary,
      source,
      affected: [...(affected ?? [])],
      reverted: false,
    });
    this.options.onStatus({ kind: "done", summary, notice, at, undoable: true });
  }

  private fail(job: Job, error: unknown): void {
    if (error instanceof Cancelled) {
      this.log(job, "rejected");
      this.options.onStatus({ kind: "idle" });
      return;
    }
    const text = joined(job);
    const llm: LlmError | undefined = isLlmError(error) ? error : undefined;
    const why = llm
      ? llm.message
      : error instanceof Error
        ? error.message
        : "Something went wrong.";
    if (llm?.code === "ModelNotLoaded") {
      // Nothing was added; the user loads the model and presses Try again.
      this.lastFailed = job;
      this.options.onStatus({
        kind: "failed",
        message: `${this.options.modelName} isn't loaded in LM Studio. Load it, then try again.`,
        text,
      });
      return;
    }
    // A failed command changes nothing; a failed note is kept as the user's own words.
    const editor = this.options.editor();
    if (job.mode === "input" && editor) {
      try {
        editor.apply(
          unprocessedPatch(editor.getDoc(), text, editor.cursorBlockId(), this.options.ids),
        );
        this.log(job, "unprocessed");
        this.options.onStatus({
          kind: "done",
          summary: "Added your words as a note",
          notice: `${why} I kept your words as they are.`,
          at: this.now(),
          undoable: true,
        });
        return;
      } catch {
        // Fall through to the error state below.
      }
    }
    this.log(job, "failed");
    this.lastFailed = job;
    this.options.onStatus({ kind: "failed", message: why, text });
  }
}

const patchBlocks = (patch: BlockPatch): Block[] =>
  patch.steps.flatMap((s) => (s.kind === "insert" ? s.blocks : []));
