/** Only these LM Studio endpoints, only on this machine. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const PATHS = new Set(["/v1/models", "/v1/chat/completions"]);

export function checkLlmUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("Lucid only talks to LM Studio on this computer.");
  }
  if (!PATHS.has(parsed.pathname))
    throw new Error(`Not an LM Studio endpoint Lucid uses: ${parsed.pathname}`);
  return parsed;
}
