export interface PrevioCredentialCandidate {
  user: string;
  pass: string;
  source: string;
}

interface PrevioFetchOptions {
  credentialsSecretName?: string | null;
  path: string;
  pmsHotelId: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function clean(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function pushCandidate(
  target: PrevioCredentialCandidate[],
  seen: Set<string>,
  user: string,
  pass: string,
  source: string,
) {
  const safeUser = clean(user);
  const safePass = clean(pass);
  if (!safeUser || !safePass) return;

  const key = `${safeUser}\u0000${safePass}`;
  if (seen.has(key)) return;

  seen.add(key);
  target.push({ user: safeUser, pass: safePass, source });
}

function parseNamedPairs(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of raw.split(/\r?\n|;/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    parsed[match[1].toLowerCase()] = clean(match[2]);
  }
  return parsed;
}

function parseSecretCandidates(secretValue: string, source: string): PrevioCredentialCandidate[] {
  const candidates: PrevioCredentialCandidate[] = [];
  const seen = new Set<string>();
  const raw = clean(secretValue);

  if (!raw) return candidates;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const user = parsed.username ?? parsed.user ?? parsed.login ?? parsed.email;
      const pass = parsed.password ?? parsed.pass ?? parsed.secret;
      pushCandidate(candidates, seen, user, pass, source);
    }
  } catch {
    // Ignore JSON parse failures and try other supported formats.
  }

  const named = parseNamedPairs(raw);
  pushCandidate(
    candidates,
    seen,
    named.username ?? named.user ?? named.login ?? named.email,
    named.password ?? named.pass ?? named.secret,
    source,
  );

  const firstColon = raw.indexOf(":");
  if (firstColon > 0 && !/^https?:\/\//i.test(raw)) {
    pushCandidate(candidates, seen, raw.slice(0, firstColon), raw.slice(firstColon + 1), source);
  }

  return candidates;
}

export function getPrevioCredentialCandidates(credentialsSecretName?: string | null): PrevioCredentialCandidate[] {
  const candidates: PrevioCredentialCandidate[] = [];
  const seen = new Set<string>();

  if (credentialsSecretName) {
    const secretValue = Deno.env.get(credentialsSecretName) || "";
    for (const candidate of parseSecretCandidates(secretValue, credentialsSecretName)) {
      pushCandidate(candidates, seen, candidate.user, candidate.pass, candidate.source);
    }
  }

  pushCandidate(
    candidates,
    seen,
    Deno.env.get("PREVIO_API_USERNAME"),
    Deno.env.get("PREVIO_API_PASSWORD"),
    "PREVIO_API_USERNAME/PASSWORD",
  );
  pushCandidate(
    candidates,
    seen,
    Deno.env.get("PREVIO_API_USER"),
    Deno.env.get("PREVIO_API_PASSWORD"),
    "PREVIO_API_USER/PASSWORD",
  );

  return candidates;
}

export async function fetchPrevioWithAuth(options: PrevioFetchOptions): Promise<{ response: Response; source: string }> {
  const candidates = getPrevioCredentialCandidates(options.credentialsSecretName);
  if (candidates.length === 0) {
    throw new Error(
      options.credentialsSecretName
        ? `Previo credentials not configured. Supported secret formats for ${options.credentialsSecretName}: username:password, JSON {"username","password"}, or USERNAME/PASSWORD pairs.`
        : "Previo credentials not configured.",
    );
  }

  const baseUrl = clean(Deno.env.get("PREVIO_API_BASE_URL") || Deno.env.get("PREVIO_API_URL") || "https://api.previo.app").replace(/\/+$/, "");
  const url = `${baseUrl}${options.path.startsWith("/") ? options.path : `/${options.path}`}`;

  let lastErrorBody = "";
  let lastSource = "";
  let lastStatus = 0;

  for (const candidate of candidates) {
    console.log(`Trying Previo credentials from: ${candidate.source}`);

    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Basic ${btoa(`${candidate.user}:${candidate.pass}`)}`,
        "X-Previo-Hotel-ID": String(options.pmsHotelId || ""),
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body,
    });

    if (response.ok) {
      console.log(
        `Previo authenticated successfully via ${candidate.source} (status=${response.status}, content-type=${response.headers.get("content-type") || "?"}, finalUrl=${response.url})`,
      );
      return { response, source: candidate.source };
    }

    const errorBody = await response.text();
    lastErrorBody = errorBody;
    lastSource = candidate.source;
    lastStatus = response.status;
    console.error(`Previo ${response.status} via ${candidate.source}: ${errorBody.slice(0, 300)}`);

    if (response.status !== 401 && response.status !== 403) {
      return {
        response: new Response(errorBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        source: candidate.source,
      };
    }
  }

  throw new Error(
    `Previo authentication failed for all credential sources. Last (${lastSource || "unknown"}): ${lastStatus ? `[${lastStatus}] ` : ""}${lastErrorBody.slice(0, 300)}`,
  );
}

/**
 * Safely parse a Previo response body as JSON. If Previo returns HTML
 * (e.g. a docs/help/redirect page) on a 2xx, throw a descriptive error
 * with status, content-type, final URL, and a body snippet so the UI and
 * import-history can show what actually happened instead of a raw
 * "Unexpected token '<'" SyntaxError.
 */
export async function safePrevioJson<T = unknown>(
  response: Response,
  context: { path: string; source?: string },
): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!contentType.toLowerCase().includes("json")) {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new Error(
      `Previo returned non-JSON from ${context.path} (status=${response.status}, content-type=${contentType || "?"}, finalUrl=${response.url}${context.source ? `, via=${context.source}` : ""}): ${snippet}`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const snippet = text.slice(0, 300);
    throw new Error(
      `Previo returned malformed JSON from ${context.path} (status=${response.status}, content-type=${contentType}): ${snippet}`,
    );
  }
}