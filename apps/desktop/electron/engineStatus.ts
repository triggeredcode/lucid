import type { PdfProgress } from "./ipc/types";

/**
 * What a window that opens late should know about the preparation of the PDF engine: that it is running (with its count), or
 * why it failed. A failure is handed over once; the preparation can fail within milliseconds, before the page and its buttons
 * exist, so a message sent only at that moment would be lost.
 */
export class EngineStatus {
  private preparing: PdfProgress | null = null;
  private failure: PdfProgress | null = null;

  report(progress: PdfProgress): void {
    if (progress.phase !== "warmup") return;
    this.preparing = progress.done === true ? null : progress;
    this.failure = progress.done === true && progress.message ? progress : null;
  }

  read(): PdfProgress | null {
    const status = this.preparing ?? this.failure;
    this.failure = null;
    return status;
  }
}
