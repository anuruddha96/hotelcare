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
      /** Optional dedicated XML login (Previo XML API accepts login/password, NOT the REST ApiKey). */
      xmlLogin?: string;
      xmlPassword?: string;
      source: string;
    }
  | {
      protocol: "rest";
      username: string;
      password: string;
      /** REST keys are often saved as the password; XML calls may need the same value as ApiKey auth. */
      apiKey?: string;
      authElement?: string;
      /** Optional dedicated XML login for tenants that mix REST + XML. */
      xmlLogin?: string;
      xmlPassword?: string;
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
      const xmlApiKey = clean(j.xmlApiKey ?? j.xml_api_key ?? apiKey ?? j.token ?? password) || undefined;
      const authElement = clean(j.authElement ?? j.auth_element) || "apiKey";
      const xmlLogin = clean(j.xmlLogin ?? j.xml_login ?? j.xmlUsername ?? j.xml_username) || undefined;
      const xmlPassword = clean(j.xmlPassword ?? j.xml_password) || undefined;

      if (protocol === "xml") {
        if (!apiKey) {
          throw new PrevioCredentialParseError(
            `Previo credential "${sourceName}" declares protocol=xml but has no apiKey field.`,
          );
        }
        return { protocol: "xml", apiKey, authElement, xmlLogin, xmlPassword, source: sourceName };
      }
      if (protocol === "rest") {
        if (!username || !password) {
          throw new PrevioCredentialParseError(
            `Previo credential "${sourceName}" declares protocol=rest but is missing username or password.`,
          );
        }
        return { protocol: "rest", username, password, apiKey: xmlApiKey, authElement, xmlLogin, xmlPassword, source: sourceName };
      }

      // Implicit protocol inference from present fields.
      if (apiKey && !username && !password) {
        return { protocol: "xml", apiKey, authElement, xmlLogin, xmlPassword, source: sourceName };
      }
      if (username && password) {
        return { protocol: "rest", username, password, apiKey: xmlApiKey, authElement, xmlLogin, xmlPassword, source: sourceName };
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
  const namedXmlApiKey = clean(named.xmlapikey ?? named.xml_api_key ?? namedApiKey ?? named.password ?? named.pass ?? named.secret) || undefined;
  const namedUser = clean(named.username ?? named.user ?? named.login ?? named.email);
  const namedPass = clean(named.password ?? named.pass ?? named.secret);
  if (namedApiKey && !namedUser && !namedPass) {
    return { protocol: "xml", apiKey: namedApiKey, authElement: "apiKey", source: sourceName };
  }
  if (namedUser && namedPass) {
    return { protocol: "rest", username: namedUser, password: namedPass, apiKey: namedXmlApiKey, authElement: "apiKey", source: sourceName };
  }

  // 3) user:pass single line — REST only.
  if (!/^https?:\/\//i.test(raw)) {
    const m = raw.match(/^([^:\s]+):(.+)$/);
    if (m) {
      const password = clean(m[2]);
      return { protocol: "rest", username: clean(m[1]), password, apiKey: password, authElement: "apiKey", source: sourceName };
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
  | "restLoginPassword" // <login>USERNAME</login><password>PASSWORD</password>
  | "header";       // HTTP header Api-Key: KEY, no auth in XML

function buildXmlAuthBlock(creds: PrevioCredentials, variant?: PrevioXmlAuthVariant): string {
  // Dedicated XML login/password ALWAYS wins for XML calls — the REST ApiKey
  // is rejected by Previo's XML endpoint (401 Invalid login or password).
  if (creds.xmlLogin && creds.xmlPassword) {
    return `<login>${xmlEscape(creds.xmlLogin)}</login><password>${xmlEscape(creds.xmlPassword)}</password>`;
  }
  if (creds.protocol === "rest") {
    const apiKey = xmlEscape(creds.apiKey || "");
    if (apiKey) {
      if (variant === "authorizationApiKey" || variant === "header") return ``;
      if (variant === "apiKey") return `<${creds.authElement || "apiKey"}>${apiKey}</${creds.authElement || "apiKey"}>`;
    }
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
  /** Preferred XML auth variant. Authentication failures still fall through to other variants. */
  authVariant?: PrevioXmlAuthVariant;
}

export interface PrevioXmlCallResult {
  ok: boolean;
  status: number;
  /** Raw response text — caller may parse. */
  text: string;
  /** Parsed <error><message> if present, else null. */
  errorMessage: string | null;
  /** XML auth variant used for this response. Useful when the tenant accepts a legacy body variant. */
  usedAuthVariant?: PrevioXmlAuthVariant | null;
}

const XML_AUTH_FALLBACK_ORDER: PrevioXmlAuthVariant[] = [
  "authorizationApiKey",
  "apiKey",
  "login",
  "password",
  "loginPassword",
  "header",
];

const REST_XML_AUTH_FALLBACK_ORDER: PrevioXmlAuthVariant[] = [
  "authorizationApiKey",
  "apiKey",
  "header",
  "restLoginPassword",
];

async function callPrevioXmlOnce(
  opts: PrevioXmlCallOptions,
  authVariant?: PrevioXmlAuthVariant,
): Promise<PrevioXmlCallResult> {
  const auth = buildXmlAuthBlock(opts.creds, authVariant);
  const body = `<?xml version="1.0"?>
<request>
${auth}
<hotId>${xmlEscape(String(opts.pmsHotelId || ""))}</hotId>
${opts.extraXml ?? ""}
</request>`;

  const headers: Record<string, string> = { "Content-Type": "text/xml; charset=UTF-8" };
  const hasDedicatedXmlLogin = !!(opts.creds.xmlLogin && opts.creds.xmlPassword);
  const effectiveXmlAuthVariant = hasDedicatedXmlLogin
    ? ("login" as PrevioXmlAuthVariant)
    : opts.creds.protocol === "xml"
      ? authVariant ?? (opts.creds.authElement === "apiKey" ? "authorizationApiKey" : opts.creds.authElement)
      : authVariant ?? "restLoginPassword";
  // Only attach ApiKey headers when we're actually authenticating via header
  // (no dedicated XML login). Otherwise Previo can reject login+header combos.
  const headerApiKey = !hasDedicatedXmlLogin
    ? (opts.creds.protocol === "xml" ? opts.creds.apiKey : opts.creds.apiKey || "")
    : "";
  if (headerApiKey && effectiveXmlAuthVariant === "authorizationApiKey") {
    headers["Authorization"] = `ApiKey ${headerApiKey}`;
  } else if (headerApiKey && effectiveXmlAuthVariant === "header") {
    headers["Api-Key"] = headerApiKey;
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
  return { ok, status: resp.status, text, errorMessage, usedAuthVariant: effectiveXmlAuthVariant };
}

/** POST an XML method call. Never logs credentials. */
export async function callPrevioXml(opts: PrevioXmlCallOptions): Promise<PrevioXmlCallResult> {
  // Dedicated XML login/password bypasses the auth-variant fallback loop —
  // there is only one valid auth path in that case.
  if (opts.creds.xmlLogin && opts.creds.xmlPassword) {
    return await callPrevioXmlOnce(opts, "login");
  }
  const preferred = opts.authVariant
    ?? (opts.creds.protocol === "xml"
      ? (opts.creds.authElement === "apiKey" ? "authorizationApiKey" : opts.creds.authElement as PrevioXmlAuthVariant)
      : (opts.creds.apiKey ? "authorizationApiKey" : "restLoginPassword"));
  const fallbackOrder = opts.creds.protocol === "xml"
    ? XML_AUTH_FALLBACK_ORDER
    : (opts.creds.apiKey ? REST_XML_AUTH_FALLBACK_ORDER : ["restLoginPassword" as PrevioXmlAuthVariant]);
  const variants = [
    preferred,
    ...fallbackOrder.filter((variant) => variant !== preferred),
  ];
  const attempts: string[] = [];
  let last: PrevioXmlCallResult | null = null;

  for (const variant of variants) {
    const result = await callPrevioXmlOnce(opts, variant);
    if (result.ok) return result;

    attempts.push(`${variant}=${result.status}${result.errorMessage ? `(${result.errorMessage})` : ""}`);
    last = result;

    // Only authentication-style failures should fall through to other auth
    // variants. For validation/rate-limit/server errors, return immediately so
    // callers see the real Previo error instead of masking it with retries.
    const authRejected = result.status === 401 || result.status === 403
      || /invalid login|invalid password|unauthori[sz]ed|forbidden/i.test(result.errorMessage || result.text.slice(0, 500));
    if (!authRejected) return result;
  }

  return {
    ok: false,
    status: last?.status ?? 0,
    text: last?.text ?? "",
    errorMessage: `Previo rejected every XML auth variant. Attempts: ${attempts.join("; ")}`,
    usedAuthVariant: last?.usedAuthVariant ?? null,
  };
}
