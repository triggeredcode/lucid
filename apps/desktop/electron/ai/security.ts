const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Cloud endpoints require HTTPS; plaintext HTTP is allowed only on this machine. */
export function validateProviderEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The provider address is not a valid URL.");
  }
  if (url.username || url.password)
    throw new Error("Provider credentials must not be included in the address.");
  if (url.hash || url.search)
    throw new Error("The provider address cannot include a query or fragment.");
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !local)
    throw new Error("Provider addresses must use HTTPS; HTTP is allowed only on this computer.");
  return url;
}

/** Redirects are deliberately same-origin so an Authorization header can never cross origins. */
export function validateProviderRedirect(from: URL, location: string): URL {
  const target = validateProviderEndpoint(new URL(location, from).href);
  if (target.origin !== from.origin) throw new Error("The provider redirected to another origin.");
  return target;
}

/** Fetch with redirects disabled at the platform layer and revalidated before following. */
export async function secureProviderFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  let url = validateProviderEndpoint(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  let options = { ...init };
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await doFetch(url, { ...options, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("The provider returned a redirect without a destination.");
    if (redirects === 5) throw new Error("The provider redirected too many times.");
    url = validateProviderRedirect(url, location);
    if (response.status === 303) {
      const { body: _body, ...withoutBody } = options;
      options = { ...withoutBody, method: "GET" };
    }
  }
  throw new Error("The provider redirected too many times.");
}

/** A last line of defence for errors that may be shown or logged. */
export function redactSensitive(value: unknown, secrets: readonly string[] = []): string {
  let text = value instanceof Error ? value.message : String(value);
  text = text.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [redacted]");
  text = text.replace(/([?&](?:api[_-]?key|token|access_token|key)=)[^&\s]+/gi, "$1[redacted]");
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[redacted]");
  }
  return text.slice(0, 500);
}
