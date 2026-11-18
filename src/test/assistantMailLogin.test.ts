import { describe, expect, it } from "vitest";
import {
  classifyMailLoginFailure,
  isGoogleMailHost,
  looksLikeGoogleAppPassword,
  mailLoginMessage,
  normalizeMailboxPassword,
  serverReplyForLog,
} from "../../supabase/functions/_shared/mailLogin";

// Replies as Google's IMAP and SMTP servers actually send them.
const GOOGLE = {
  imapWrong: "[AUTHENTICATIONFAILED] Invalid credentials (Failure)",
  imapAppPassword: "[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)",
  imapWebLogin: "[WEBALERT https://accounts.google.com/signin/continue?sarp=1&scc=1&plt=AKgnsbs] Web login required.",
  imapDisabled: "[ALERT] Your account is not enabled for IMAP use. Please visit your Gmail settings page and enable your account for IMAP access. (Failure)",
  imapTooMany: "[ALERT] Too many simultaneous connections. (Failure)",
  smtpWrong: "535-5.7.8 Username and Password not accepted. For more information, go to\n535 5.7.8  https://support.google.com/mail/?p=BadCredentials a1-20020a170906",
  smtpAppPassword: "534-5.7.9 Application-specific password required. For more information, go to\n534 5.7.9  https://support.google.com/mail/?p=InvalidSecondFactor",
  smtpWebLogin: "534-5.7.14 <https://accounts.google.com/signin/continue?sarp=1> Please log in via your web browser and\n534-5.7.14 then try again.",
};

describe("mailbox password clean-up", () => {
  it("removes the display spaces from a Google app password", () => {
    expect(normalizeMailboxPassword("abcd efgh ijkl mnop", { google: true })).toBe("abcdefghijklmnop");
    expect(normalizeMailboxPassword(" abcd efgh ijkl​mnop\n", { google: true })).toBe("abcdefghijklmnop");
    expect(looksLikeGoogleAppPassword("abcd efgh ijkl mnop")).toBe(true);
    expect(looksLikeGoogleAppPassword("abcdefghijklmnop")).toBe(true);
  });

  it("keeps passwords for other providers exactly as typed", () => {
    expect(normalizeMailboxPassword("my secret pass ", { google: false })).toBe("my secret pass ");
  });

  it("does not mistake a normal password for an app password", () => {
    expect(looksLikeGoogleAppPassword("Summer2026!")).toBe(false);
    expect(looksLikeGoogleAppPassword("abcd efgh ijkl")).toBe(false);
    expect(looksLikeGoogleAppPassword("abcd efgh ijkl mnop q")).toBe(false);
  });

  it("recognises Google mail hosts", () => {
    expect(isGoogleMailHost("imap.gmail.com")).toBe(true);
    expect(isGoogleMailHost("smtp.gmail.com.")).toBe(true);
    expect(isGoogleMailHost("aspmx.l.google.com")).toBe(true);
    expect(isGoogleMailHost("mail.rdhotels.hu")).toBe(false);
    expect(isGoogleMailHost("notgmail.com.evil.io")).toBe(false);
  });
});

describe("why a mail server refused the sign-in", () => {
  it("reads Google's IMAP replies", () => {
    expect(classifyMailLoginFailure(GOOGLE.imapWrong)).toBe("wrong_password");
    expect(classifyMailLoginFailure(GOOGLE.imapAppPassword)).toBe("app_password_required");
    expect(classifyMailLoginFailure(GOOGLE.imapWebLogin)).toBe("web_login_required");
    expect(classifyMailLoginFailure(GOOGLE.imapDisabled)).toBe("imap_disabled");
    expect(classifyMailLoginFailure(GOOGLE.imapTooMany)).toBe("too_many_connections");
  });

  it("reads Google's SMTP replies", () => {
    expect(classifyMailLoginFailure(GOOGLE.smtpWrong)).toBe("wrong_password");
    expect(classifyMailLoginFailure(GOOGLE.smtpAppPassword)).toBe("app_password_required");
    expect(classifyMailLoginFailure(GOOGLE.smtpWebLogin)).toBe("web_login_required");
  });

  it("falls back to unknown without a server reply", () => {
    expect(classifyMailLoginFailure("")).toBe("unknown");
    expect(classifyMailLoginFailure(null)).toBe("unknown");
  });
});

describe("what the person is told", () => {
  const email = "name@gmail.com";

  it("spots a normal Google password and says how long it is", () => {
    const text = mailLoginMessage("wrong_password", { google: true, email, password: "Summer2026!" });
    expect(text).toContain("16 letters");
    expect(text).toContain("11 characters");
    expect(text).toContain("myaccount.google.com/apppasswords");
  });

  it("treats a pasted app password with spaces as an app password", () => {
    const text = mailLoginMessage("wrong_password", { google: true, email, password: "abcd efgh ijkl mnop" });
    expect(text).toContain(email);
    expect(text).toContain("Spaces are removed automatically");
    expect(text).not.toContain("normal Google password.");
  });

  it("explains Google's other refusals", () => {
    expect(mailLoginMessage("app_password_required", { google: true, email, password: "x" })).toContain("2-Step Verification");
    expect(mailLoginMessage("web_login_required", { google: true, email, password: "x" })).toContain("security alert");
    expect(mailLoginMessage("imap_disabled", { google: true, email, password: "x" })).toContain("Enable IMAP");
  });

  it("keeps the generic wording for other providers", () => {
    expect(mailLoginMessage("wrong_password", { google: false, email: "a@hotel.hu", password: "x" }))
      .toBe("The email address or password was not accepted by the mail server.");
  });

  it("masks anything credential-like in the logged server reply", () => {
    const logged = serverReplyForLog(`AUTH failed ${"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo".repeat(2)} end`);
    expect(logged).toBe("AUTH failed […] end");
  });
});
