// One place that knows how to send e-mail for the whole app.
//
// Every outgoing message (ticket notifications, password resets, the morning
// revenue digest) goes through here so that:
//   * the sender name/address comes from the organization's Email settings,
//   * an organization can switch transactional mail or the digest off,
//   * a bad Resend key produces one clear, human message instead of silence.

export interface EmailSettings {
  organization_slug: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  transactional_enabled: boolean;
  digest_enabled: boolean;
}

export const DEFAULT_SETTINGS: EmailSettings = {
  organization_slug: "",
  from_name: "Hotel Care",
  from_email: "onboarding@resend.dev",
  reply_to: null,
  transactional_enabled: true,
  digest_enabled: true,
};

const RESEND_API = "https://api.resend.com";

type MinimalClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> };
    };
  };
};

export async function loadEmailSettings(
  admin: MinimalClient,
  organizationSlug?: string | null,
): Promise<EmailSettings> {
  if (!organizationSlug) return { ...DEFAULT_SETTINGS };
  try {
    const { data } = await admin
      .from("email_settings")
      .select("organization_slug, from_name, from_email, reply_to, transactional_enabled, digest_enabled")
      .eq("organization_slug", organizationSlug)
      .maybeSingle();
    if (!data) return { ...DEFAULT_SETTINGS, organization_slug: organizationSlug };
    return { ...DEFAULT_SETTINGS, ...(data as Partial<EmailSettings>) } as EmailSettings;
  } catch {
    return { ...DEFAULT_SETTINGS, organization_slug: organizationSlug };
  }
}

export function senderString(s: Pick<EmailSettings, "from_name" | "from_email">): string {
  const name = (s.from_name || "Hotel Care").replace(/[<>]/g, "").trim();
  const email = (s.from_email || DEFAULT_SETTINGS.from_email).trim();
  return `${name} <${email}>`;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  from?: string;
  error?: string;
  /** True when the key itself is the problem — the UI can then tell the user to update the secret. */
  keyProblem?: boolean;
  skipped?: boolean;
}

function humanError(status: number, body: string): { message: string; keyProblem: boolean } {
  const lower = body.toLowerCase();
  // Order matters: Resend answers 403 both for a bad key and for the sandbox
  // sender restriction, so the specific messages are matched first.
  if (/you can only send testing emails to your own email address/.test(lower)) {
    const owner = body.match(/\(([^)]+@[^)]+)\)/)?.[1];
    return {
      message:
        `The sandbox sender onboarding@resend.dev only delivers to the Resend account owner${owner ? ` (${owner})` : ""}. ` +
        "Verify your own domain at resend.com/domains and save that address in Email settings — then everyone receives the digest.",
      keyProblem: false,
    };
  }
  if (/domain is not verified|not verified/.test(lower)) {
    return {
      message:
        "The sender domain is not verified in Resend. Verify it at resend.com/domains, then save that address in Email settings.",
      keyProblem: false,
    };
  }
  if (status === 401 || status === 403 || /api key is invalid|restricted api key|unauthorized/.test(lower)) {
    return {
      message:
        "Resend rejected the API key. Open Email settings and save a valid Resend key (Resend → API Keys, with sending permission).",
      keyProblem: true,
    };
  }
  return { message: `Resend responded ${status}: ${body.slice(0, 400)}`, keyProblem: false };
}

/** Verified sending domains on the Resend account, newest usable first. */
async function verifiedDomains(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${RESEND_API}/domains`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return [];
    const parsed = await res.json().catch(() => null);
    const list = Array.isArray(parsed?.data) ? parsed.data : [];
    return list
      .filter((d: { status?: string }) => String(d.status ?? "").toLowerCase() === "verified")
      .map((d: { name?: string }) => String(d.name ?? ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}


/** Raw send — no settings lookup, no on/off checks. */
export async function sendViaResend(opts: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  replyTo?: string | null;
}): Promise<SendResult> {
  const res = await fetch(`${RESEND_API}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const { message, keyProblem } = humanError(res.status, text);
    console.error(`resend send failed [${res.status}] from=${opts.from}: ${text}`);
    return { ok: false, error: message, keyProblem, from: opts.from };
  }
  let id: string | undefined;
  try { id = JSON.parse(text)?.id; } catch { /* ignore */ }
  return { ok: true, id, from: opts.from };
}

/**
 * The normal entry point. Resolves the organization's settings, honours the
 * on/off switches, and falls back to the Resend sandbox sender if the branded
 * one is refused, so a domain mistake never swallows the mail silently.
 */
export async function sendEmail(opts: {
  admin: MinimalClient;
  organizationSlug?: string | null;
  to: string[];
  subject: string;
  html: string;
  kind?: "transactional" | "digest";
  settings?: EmailSettings;
}): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      error: "No RESEND_API_KEY is configured. Add it in Email settings before sending.",
      keyProblem: true,
    };
  }
  const recipients = [...new Set(opts.to.filter((x) => !!x && /\S+@\S+\.\S+/.test(x)))];
  if (recipients.length === 0) return { ok: false, error: "No valid recipient address." };

  const settings = opts.settings ?? (await loadEmailSettings(opts.admin, opts.organizationSlug));
  const kind = opts.kind ?? "transactional";
  if (kind === "transactional" && !settings.transactional_enabled) {
    return { ok: false, skipped: true, error: "Transactional e-mails are switched off for this organization." };
  }
  if (kind === "digest" && !settings.digest_enabled) {
    return { ok: false, skipped: true, error: "The daily digest is switched off for this organization." };
  }

  const name = (settings.from_name || "Hotel Care").replace(/[<>]/g, "").trim();
  const primary = senderString(settings);
  const primaryDomain = (settings.from_email || DEFAULT_SETTINGS.from_email).split("@")[1]?.toLowerCase() ?? "";
  const senders = [primary];

  // The Resend sandbox sender only reaches the account owner, so when no real
  // sender is configured we look up a verified domain and use that instead —
  // the digest then reaches every recipient without any manual setup.
  if (primaryDomain === "resend.dev") {
    for (const domain of await verifiedDomains(apiKey)) {
      senders.unshift(`${name} <noreply@${domain}>`);
    }
  }

  let last: SendResult = { ok: false, error: "unknown error" };
  for (const from of senders) {
    const result = await sendViaResend({
      apiKey, from, to: recipients, subject: opts.subject, html: opts.html, replyTo: settings.reply_to,
    });
    if (result.ok) return result;
    last = result;
    if (result.keyProblem) break; // a bad key fails the same for every sender
  }
  return last;

}

/** Checks the stored key against Resend and returns the verified domains. */
export async function checkResendKey(): Promise<{
  configured: boolean;
  valid: boolean;
  error?: string;
  domains: { name: string; status: string }[];
}> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { configured: false, valid: false, domains: [], error: "No RESEND_API_KEY is configured." };
  const res = await fetch(`${RESEND_API}/domains`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  if (!res.ok) {
    const { message } = humanError(res.status, text);
    // A key restricted to sending cannot list domains — that is still a usable key.
    if (res.status === 401 || res.status === 403) {
      if (/restricted/i.test(text)) return { configured: true, valid: true, domains: [], error: undefined };
      return { configured: true, valid: false, domains: [], error: message };
    }
    return { configured: true, valid: false, domains: [], error: message };
  }
  let domains: { name: string; status: string }[] = [];
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed?.data) ? parsed.data : [];
    domains = list.map((d: { name?: string; status?: string }) => ({
      name: String(d.name ?? ""), status: String(d.status ?? "unknown"),
    }));
  } catch { /* ignore */ }
  return { configured: true, valid: true, domains };
}

/**
 * Drop-in replacement for the old `new Resend(key)` usage.
 *
 * Older functions call `resend.emails.send({ from, to, subject, html })` with a
 * hard-coded sender. This adapter ignores that sender and uses the
 * organization's Email settings instead, so changing the sender in one place
 * changes every message the app sends.
 */
export function mailClient(organizationSlug?: string | null) {
  const admin = {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            const url = Deno.env.get("SUPABASE_URL");
            const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (!url || !key) return { data: null };
            const res = await fetch(
              `${url}/rest/v1/${table}?select=${encodeURIComponent(cols)}&${col}=eq.${encodeURIComponent(val)}&limit=1`,
              { headers: { apikey: key, Authorization: `Bearer ${key}` } },
            );
            if (!res.ok) return { data: null };
            const rows = await res.json().catch(() => []);
            return { data: Array.isArray(rows) ? rows[0] ?? null : null };
          },
        }),
      }),
    }),
  };

  return {
    emails: {
      send: async (msg: { from?: string; to: string[] | string; subject: string; html: string }) => {
        const to = Array.isArray(msg.to) ? msg.to : [msg.to];
        const result = await sendEmail({
          admin,
          organizationSlug,
          to,
          subject: msg.subject,
          html: msg.html,
          kind: "transactional",
        });
        if (!result.ok) return { data: null, error: { message: result.error ?? "send failed" } };
        return { data: { id: result.id ?? "sent" }, error: null };
      },
    },
  };
}
