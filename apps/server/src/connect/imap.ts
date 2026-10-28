/**
 * Any mailbox, by its IMAP login (an app password for Gmail or Outlook, the host's login for any
 * other). Connecting checks the login on the server; reading takes the messages since the last read.
 * The SMTP details are kept for the day sends are wired; nothing is sent today.
 */

import { ImapFlow } from "imapflow";
import { keepItem, markConnected, markFailed, type ConnectRow } from "./store";


export interface ImapCreds {
  host: string;
  port: number;
  user: string;
  password: string;
  smtpHost: string | null;
  smtpPort: number | null;
}

function client(c: ImapCreds): ImapFlow {
  return new ImapFlow({ host: c.host, port: c.port, secure: c.port === 993, auth: { user: c.user, pass: c.password }, logger: false, socketTimeout: 30_000 });
}

export async function connectImap(row: ConnectRow, v: Record<string, string>): Promise<void> {
  const address = (v.address ?? "").trim();
  const creds: ImapCreds = {
    host: (v.host ?? "").trim(),
    port: Number(v.port || 993),
    user: (v.user || address).trim(),
    password: v.password ?? "",
    smtpHost: v.smtpHost?.trim() || null,
    smtpPort: v.smtpPort ? Number(v.smtpPort) : null,
  };
  const c = client(creds);
  try {
    await c.connect();
    await c.mailboxOpen("INBOX", { readOnly: true });
    await c.logout();
    await markConnected(row.id, address, creds);
  } catch (e) {
    await markFailed(row.id, `The mail server refused the login: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** New messages in the inbox since the last read (7 days the first time). */
export async function readImap(row: ConnectRow, creds: ImapCreds): Promise<number> {
  const c = client(creds);
  let added = 0;
  try {
    await c.connect();
  } catch (e) {
    await markFailed(row.id, `The mail server refused the login: ${e instanceof Error ? e.message : String(e)}`, "to_reconnect");
    throw e;
  }
  try {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const since = row.last_read_at ? new Date(row.last_read_at.getTime() - 86400_000) : new Date(Date.now() - 7 * 86400_000);
      const uids = (await c.search({ since }, { uid: true })) || [];
      if (uids.length) {
        for await (const m of c.fetch(uids.slice(-200), { envelope: true, uid: true, internalDate: true }, { uid: true })) {
          const env = m.envelope;
          const id = env?.messageId ?? `uid:${m.uid}`;
          const at = m.internalDate instanceof Date ? m.internalDate : new Date();
          if (await keepItem(row.id, id, "email", "in", at, { from: env?.from?.[0]?.address ?? null, to: env?.to?.map((x) => x.address).join(", ") ?? null, subject: env?.subject ?? null })) added++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => undefined);
  }
  return added;
}
