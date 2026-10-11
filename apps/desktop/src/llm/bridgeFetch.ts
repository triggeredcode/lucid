/**
 * A `fetch` that goes through the main process (LM Studio sends no CORS headers, so the window cannot call it
 * directly). It only needs to be good enough for the LM Studio client: GET and POST with a string body, and a
 * streamed response body.
 */
let counter = 0;

export const bridgeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const id = ++counter;
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller;
    },
    cancel() {
      void window.lucid.llm.abort(id);
    },
  });
  const stop = window.lucid.llm.onEvent((event) => {
    if (event.id !== id || finished) return;
    if (event.type === "chunk") stream.enqueue(event.data);
    else {
      finished = true;
      stop();
      if (event.type === "end") stream.close();
      else stream.error(new TypeError(event.message));
    }
  });
  const onAbort = () => {
    void window.lucid.llm.abort(id);
    if (!finished) {
      finished = true;
      stop();
      stream.error(new DOMException("Aborted", "AbortError"));
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const head = await window.lucid.llm.start({
    id,
    url,
    method: init?.method ?? "GET",
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof init?.body === "string" ? init.body : undefined,
  });
  if (!head.ok) {
    finished = true;
    stop();
    signal?.removeEventListener("abort", onAbort);
    throw new TypeError(head.message);
  }
  return new Response(body, { status: head.status, headers: head.headers });
};
