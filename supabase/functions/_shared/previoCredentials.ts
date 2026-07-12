// Shared Previo credential parser.
//
// Supports two protocols and preserves back-compat with legacy formats:
//
//   XML  (single-key auth — e.g. Ottofiori):
//     {"protocol":"xml","apiKey":"..."}
//     {"apiKey":"..."}                       // implicit xml
//     {"protocol":"xml","apiKey":"..."}      // sent as Authorization: ApiKey ...
//
//   REST (Basic Auth username/password — legacy previo-test):
//     {"protocol":"rest","username":"...","password":"..."}
//     {"username":"...","password":"..."}    // implicit rest
//     username:password                      // colon-separated line
//     USERNAME=...\nPASSWORD=...             // named-pair lines
//
// The secret value is NEVER logged or returned by this module.

export type PrevioCredentials =
  | {
      protocol: "xml";
      apiKey: string;
      /** XML element name that wraps the api key inside <request>. Defaults to "apiKey". */
      authElement: string;
      source: string;
    }
  | {
      protocol: "rest";
      username: string;
      password: string;
      source: string;
    };

function clean(v: unknown): string {
  const s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseNamedPairs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n|;/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    out[m[1].toLowerCase()] = clean(m[2]);
  }
  return out;
}

export class PrevioCredentialParseError extends Error {}

/**
 * Parse the raw secret value into a typed credential object.
 * Throws PrevioCredentialParseError with a NON-SENSITIVE message on failure.
 */
export function parsePrevioCredentialValue(
  rawSecretValue: string,
  sourceName: string,
): PrevioCredentials {
  const raw = clean(rawSecretValue);
  if (!raw) {
    throw new PrevioCredentialParseError(
      `Previo credential secret "${sourceName}" is empty.`,
    );
  }

  // 1) JSON object — preferred format.
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") {
      const protocol = clean(j.protocol).toLowerCase();
      const apiKey = clean(j.apiKey ?? j.api_key ?? j.key ?? j.token);
      const username = clean(j.username ?? j.user ?? j.login ?? j.email);
      const password = clean(j.password ?? j.pass ?? j.secret);
      const authElement = clean(j.authElement ?? j.auth_element) || "apiKey";

      if (protocol === "xml") {
        if (!apiKey) {
          throw new PrevioCredentialParseError(
            `Previo credential "${sourceName}" declares protocol=xml but has no apiKey field.`,
          );
        }
        return { protocol: "xml", apiKey, authElement, source: sourceName };
      }
      if (protocol === "rest") {
        if (!username || !password) {
          throw new PrevioCredentialParseError(
            `Previo credential "${sourceName}" declares protocol=rest but is missing username or password.`,
          );
        }
        return { protocol: "rest", username, password, source: sourceName };
      }

      // Implicit protocol inference from present fields.
      if (apiKey && !username && !password) {
        return { protocol: "xml", apiKey, authElement, source: sourceName };
      }
      if (username && password) {
        return { protocol: "rest", username, password, source: sourceName };
      }
      throw new PrevioCredentialParseError(
        `Previo credential "${sourceName}" JSON has no recognized fields. Expected apiKey (xml) or username+password (rest).`,
      );
    }
  } catch (err) {
    if (err instanceof PrevioCredentialParseError) throw err;
    // fall through to non-JSON formats
  }

  // 2) Named pairs — USERNAME=..., PASSWORD=..., or APIKEY=...
  const named = parseNamedPairs(raw);
  const namedApiKey = clean(named.apikey ?? named.api_key ?? named.key ?? named.token);
  const namedUser = clean(named.username ?? named.user ?? named.login ?? named.email);
  const namedPass = clean(named.password ?? named.pass ?? named.secret);
  if (namedApiKey && !namedUser && !namedPass) {
    return { protocol: "xml", apiKey: namedApiKey, authElement: "apiKey", source: sourceName };
  }
  if (namedUser && namedPass) {
    return { protocol: "rest", username: namedUser, password: namedPass, source: sourceName };
  }

  // 3) user:pass single line — REST only.
  if (!/^https?:\/\//i.test(raw)) {
    const m = raw.match(/^([^:\s]+):(.+)$/);
    if (m) {
      return { protocol: "rest", username: clean(m[1]), password: clean(m[2]), source: sourceName };
    }
  }

  // 4) Bare token fallback — a single non-whitespace string with no colon,
  //    no `=`, and no JSON braces is treated as an XML apiKey. This covers
  //    the common case where the user pasted just the raw Previo secret.
  if (/^[^\s:={}\[\]"']+$/.test(raw) && raw.length >= 8) {
    return { protocol: "xml", apiKey: raw, authElement: "apiKey", source: sourceName };
  }

  throw new PrevioCredentialParseError(
    `Previo credential "${sourceName}" could not be parsed. Supported formats: ` +
      `{"protocol":"xml","apiKey":"..."}, {"protocol":"rest","username":"...","password":"..."}, ` +
      `username:password, USERNAME/PASSWORD named pairs, or a bare api key string.`,
  );
}


/** Read the configured secret from env and parse it. Never logs the value. */
export function loadPrevioCredentials(secretName: string | null | undefined): PrevioCredentials {
  const name = clean(secretName);
  if (!name) {
    throw new PrevioCredentialParseError(
      "No Previo credential secret configured on this hotel (pms_configurations.credentials_secret_name is empty).",
    );
  }
  const raw = Deno.env.get(name) ?? "";
  if (!clean(raw)) {
    throw new PrevioCredentialParseError(
      `Previo credential secret "${name}" is empty or missing in the function environment.`,
    );
  }
  return parsePrevioCredentialValue(raw, name);
}

// -------- XML helpers --------------------------------------------------------

const PREVIO_XML_ENDPOINT = "https://api.previo.app/x1";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * XML auth variants Previo may accept for a single-key credential. Previo's
 * current docs specify Authorization: ApiKey KEY. Older variants are retained
 * as fallbacks for legacy/test tenants.
 */
export type PrevioXmlAuthVariant =
  | "authorizationApiKey" // HTTP header Authorization: ApiKey KEY, no auth in XML
  | "apiKey"        // <apiKey>KEY</apiKey>
  | "login"         // <login>KEY</login><password/>
  | "password"      // <login/><password>KEY</password>
  | "loginPassword" // <login>KEY</login><password>KEY</password>
  | "header";       // HTTP header Api-Key: KEY, no auth in XML

function buildXmlAuthBlock(creds: PrevioCredentials, variant?: PrevioXmlAuthVariant): string {
  if (creds.protocol === "rest") {
    return `<login>${xmlEscape(creds.username)}</login><password>${xmlEscape(creds.password)}</password>`;
  }
  const k = xmlEscape(creds.apiKey);
  const v = variant ?? (creds.authElement === "apiKey" ? "authorizationApiKey" : (creds.authElement as PrevioXmlAuthVariant));
  switch (v) {
    case "login":         return `<login>${k}</login><password></password>`;
    case "password":      return `<login></login><password>${k}</password>`;
    case "loginPassword": return `<login>${k}</login><password>${k}</password>`;
    case "authorizationApiKey":
    case "header":        return ``; // no auth in body
    case "apiKey":
    default:              return `<${creds.authElement || "apiKey"}>${k}</${creds.authElement || "apiKey"}>`;
  }
}

export interface PrevioXmlCallOptions {
  method: "searchReservations" | "getRoomKinds" | "getRooms" | "rooms" | string;
  creds: PrevioCredentials;
  pmsHotelId: string;
  /** Extra XML body appended AFTER auth + hotId. */
  extraXml?: string;
  /** Force a specific XML auth variant (xml protocol only). */
  authVariant?: PrevioXmlAuthVariant;
}

export interface PrevioXmlCallResult {
  ok: boolean;
  status: number;
  /** Raw response text — caller may parse. */
  text: string;
  /** Parsed <error><message> if present, else null. */
  errorMessage: string | null;
}

/** POST an XML method call. Never logs credentials. */
export async function callPrevioXml(opts: PrevioXmlCallOptions): Promise<PrevioXmlCallResult> {
  const auth = buildXmlAuthBlock(opts.creds, opts.authVariant);
  const body = `<?xml version="1.0"?>
<request>
${auth}
<hotId>${xmlEscape(String(opts.pmsHotelId || ""))}</hotId>
${opts.extraXml ?? ""}
</request>`;

  const headers: Record<string, string> = { "Content-Type": "text/xml; charset=UTF-8" };
  const effectiveXmlAuthVariant = opts.creds.protocol === "xml"
    ? opts.authVariant ?? (opts.creds.authElement === "apiKey" ? "authorizationApiKey" : opts.creds.authElement)
    : null;
  if (opts.creds.protocol === "xml" && effectiveXmlAuthVariant === "authorizationApiKey") {
    headers["Authorization"] = `ApiKey ${opts.creds.apiKey}`;
  } else if (opts.creds.protocol === "xml" && effectiveXmlAuthVariant === "header") {
    headers["Api-Key"] = opts.creds.apiKey;
  }

  const methodPath = opts.method.includes("/") ? opts.method : `hotel/${opts.method}`;
  const resp = await fetch(`${PREVIO_XML_ENDPOINT}/${methodPath}/`, {
    method: "POST",
    headers,
    body,

  });
  const text = await resp.text();
  const errMatch = text.match(/<error>[\s\S]*?<message>([^<]*)<\/message>[\s\S]*?<\/error>/i)
    ?? text.match(/<message>([^<]*)<\/message>/i);
  const errorMessage = errMatch ? errMatch[1].trim() : null;
  const ok = resp.ok && !/<error>/i.test(text);
  return { ok, status: resp.status, text, errorMessage };
}
