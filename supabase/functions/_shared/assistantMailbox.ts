// One interface over every mailbox kind the assistant supports: Gmail and
// Microsoft 365 (OAuth) and any other provider over IMAP + SMTP.
//
// The IMAP/SMTP libraries are loaded only when an IMAP mailbox is used, so
// chats of people without one do not pay for them at start-up.

import {
  accessTokenFor,
  decryptToken,
  type MailAccount,
  type MailMessage,
  type MailSummary,
  readMail,
  searchMail,
  sendDraft,
} from "./assistantMail.ts";
import type { ImapSettings } from "./assistantMailImap.ts";

export type MailboxAccount = MailAccount & { settings?: Partial<ImapSettings> | null };

const imap = () => import("./assistantMailImap.ts");

function imapSettings(account: MailboxAccount): ImapSettings {
  const s = account.settings ?? {};
  if (!s.imap_host || !s.smtp_host) throw new Error("This mailbox is missing its server settings. Connect it again.");
  return {
    imap_host: String(s.imap_host),
    imap_port: Number(s.imap_port ?? 993),
    smtp_host: String(s.smtp_host),
    smtp_port: Number(s.smtp_port ?? 465),
    username: String(s.username ?? account.email),
  };
}

export async function mailboxSearch(
  service: any,
  account: MailboxAccount,
  params: { query: string | null; unreadOnly: boolean; days: number; limit: number },
): Promise<MailSummary[]> {
  if (account.provider === ("imap" as string)) {
    const { searchImap } = await imap();
    return await searchImap(imapSettings(account), await decryptToken(account.refresh_token_ciphertext), params);
  }
  return await searchMail(await accessTokenFor(service, account), account.provider, params);
}

export async function mailboxRead(service: any, account: MailboxAccount, id: string): Promise<MailMessage> {
  if (account.provider === ("imap" as string)) {
    const { readImap } = await imap();
    return await readImap(imapSettings(account), await decryptToken(account.refresh_token_ciphertext), id);
  }
  return await readMail(await accessTokenFor(service, account), account.provider, id);
}

export async function mailboxSend(
  service: any,
  account: MailboxAccount,
  draft: Parameters<typeof sendDraft>[2],
): Promise<string | null> {
  if (account.provider === ("imap" as string)) {
    const { sendImap } = await imap();
    return await sendImap(
      imapSettings(account),
      await decryptToken(account.refresh_token_ciphertext),
      { email: account.email, name: account.display_name },
      draft,
    );
  }
  return await sendDraft(await accessTokenFor(service, account), account, draft);
}
