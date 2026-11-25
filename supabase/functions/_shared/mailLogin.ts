// Password sign-in for "other mailboxes" (IMAP + SMTP): password clean-up and
// plain-language reasons for a refused sign-in. No Deno or network APIs, so
// vitest can cover it.
//
// Google only accepts an app password over IMAP/SMTP (normal Google passwords
// stopped working there in 2022 for personal accounts and in 2025 for
// Workspace). Google shows the app password as four groups of four letters,
// "abcd efgh ijkl mnop", and most people paste it exactly like that. Google
// then refuses it, so the spaces are removed before the password is used or
// stored.

export const GOOGLE_APP_PASSWORDS_URL = "https://myaccount.google.com/apppasswords";

/** A Google app password once the display spaces are removed. */
export const GOOGLE_APP_PASSWORD = /^[a-z]{16}$/i;

// Whitespace (JavaScript's \s already covers the non-breaking and thin spaces
// and the BOM) plus the zero-width characters that a copy from a web page or
// a password manager can carry.
const ANY_SPACE = /[\s᠎​-‍⁠]/g;

const GOOGLE_HOSTS = /(^|\.)(gmail\.com|googlemail\.com|google\.com)$/i;

/** imap.gmail.com, smtp.gmail.com and Google-hosted MX names. */
export function isGoogleMailHost(host: string | null | undefined): boolean {
  return GOOGLE_HOSTS.test(String(host ?? "").trim().replace(/\.$/, ""));
}

/**
 * The password exactly as it should be sent to the mail server. Google app
 * passwords lose every space; passwords for any other provider are kept as
 * typed, because a space can be a real part of them.
 */
export function normalizeMailboxPassword(password: string, options: { google: boolean }): string {
  const value = String(password ?? "");
  return options.google ? value.replace(ANY_SPACE, "") : value;
}

export function looksLikeGoogleAppPassword(password: string): boolean {
  return GOOGLE_APP_PASSWORD.test(normalizeMailboxPassword(password, { google: true }));
}

export type MailLoginReason =
  | "app_password_required"
  | "wrong_password"
  | "web_login_required"
  | "imap_disabled"
  | "too_many_connections"
  | "unknown";

/**
 * Reads the server's own words (IMAP "NO [ALERT] …" or SMTP "535-5.7.8 …").
 * Order matters: Google's "Application-specific password required" also
 * contains the word "password".
 */
export function classifyMailLoginFailure(serverText: string | null | undefined): MailLoginReason {
  const text = String(serverText ?? "");
  if (!text.trim()) return "unknown";
  if (/application-specific password|app password required|5\.7\.9/i.test(text)) return "app_password_required";
  if (/webalert|web login required|log ?in via your web browser|5\.7\.14|continue\.?\s*sign ?in|accounts\.google\.com\/(signin\/continue|displayunlockcaptcha)/i.test(text)) {
    return "web_login_required";
  }
  if (/not enabled for imap|imap (access )?(is )?(disabled|not enabled)|enable imap/i.test(text)) return "imap_disabled";
  if (/too many (simultaneous )?connections|too many login|overquota|throttl|rate limit|4\.7\.0/i.test(text)) return "too_many_connections";
  if (/authenticationfailed|invalid credentials|bad ?credentials|username and password not accepted|5\.7\.8|authentication failed|login failed|incorrect password|invalid (user|login|password)/i.test(text)) {
    return "wrong_password";
  }
  return "unknown";
}

/** What the person sees in the Mailboxes dialog after a refused sign-in. */
export function mailLoginMessage(
  reason: MailLoginReason,
  context: { google: boolean; email: string; password: string },
): string {
  const { google, email } = context;
  if (google) {
    const length = normalizeMailboxPassword(context.password, { google: true }).length;
    const notAppPassword = !looksLikeGoogleAppPassword(context.password);
    switch (reason) {
      case "app_password_required":
        return "Google needs an app password for this account, not your normal Google password. Turn on 2-Step Verification, create an app password at myaccount.google.com/apppasswords and paste the 16 letters here.";
      case "web_login_required":
        return "Google blocked this sign-in as unusual. Open Gmail, confirm Google's security alert (\"Yes, it was me\"), wait a few minutes and try again.";
      case "imap_disabled":
        return "IMAP is switched off for this Google mailbox. In Gmail open Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP. On a company Google Workspace account your administrator has to allow IMAP.";
      case "too_many_connections":
        return "Google is limiting sign-ins for this mailbox right now. Wait a minute and try again.";
      default:
        return notAppPassword
          ? `Google did not accept the password. An app password has exactly 16 letters (Google shows them in four groups); what you entered has ${length} character${length === 1 ? "" : "s"}, so it looks like your normal Google password. Create an app password at myaccount.google.com/apppasswords and paste it here.`
          : `Google did not accept this app password for ${email}. Create it while signed in to this same Google account (myaccount.google.com/apppasswords), then paste it again. Spaces are removed automatically. If you created several, use the newest one.`;
    }
  }
  switch (reason) {
    case "app_password_required":
      return "Your email provider wants an app password (a separate password for apps) instead of your normal password. Create one in the mailbox's security settings and paste it here.";
    case "web_login_required":
      return "Your email provider blocked this sign-in as unusual. Sign in to the mailbox in a browser, confirm it was you, then try again.";
    case "imap_disabled":
      return "The mail server says IMAP access is switched off for this mailbox. Turn on IMAP in the mailbox settings or ask your email provider.";
    case "too_many_connections":
      return "The mail server is limiting connections right now. Wait a minute and try again.";
    default:
      return "The email address or password was not accepted by the mail server.";
  }
}

/**
 * The server's refusal, kept for the administrators' mailbox log. Server
 * replies never contain the password, but anything that looks like an
 * encoded credential is masked anyway.
 */
export function serverReplyForLog(serverText: string | null | undefined, max = 160): string {
  return String(serverText ?? "")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "[…]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
