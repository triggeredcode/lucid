/**
 * Server-sent events from a streamed response body. Yields the data payload of each event, without the
 * "data:" prefix. Comment lines, other fields and blank keep-alives are skipped.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
    }
    const rest = (buffer + decoder.decode()).replace(/\r$/, "");
    if (rest.startsWith("data:")) yield rest.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}
