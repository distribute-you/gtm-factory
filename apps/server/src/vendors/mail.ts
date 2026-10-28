/**
 * Sending and reading mail from distribute.you's sending mailboxes, directly
 * (SMTP 587 STARTTLS, IMAP 993). The factory sends only from the senders listed
 * in FACTORY_SENDERS and reads replies with BODY.PEEK (never marks anything seen,
 * never moves or deletes).
 */

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";

export interface Sender {
  /** The From address (often an alias). */
  address: string;
  /** The real mailbox it authenticates as. */
  login: string;
  name: string;
}

interface Credential {
  address: string;
  appPassword: string;
  smtpHost: string;
  imapHost: string;
}

let credCache: Map<string, Credential> | null = null;
function credentials(): Map<string, Credential> {
  if (credCache) return credCache;
  const b64 = process.env.MAILBOX_CREDENTIALS_B64;
  if (!b64) throw new Error("MAILBOX_CREDENTIALS_B64 is not set");
  const list = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Credential[];
  credCache = new Map(list.map((c) => [c.address.toLowerCase(), { ...c, appPassword: String(c.appPassword).replace(/\s/g, "") }]));
  return credCache;
}

export function senders(): Sender[] {
  const raw = process.env.FACTORY_SENDERS;
  if (!raw) throw new Error("FACTORY_SENDERS is not set");
  const list = JSON.parse(raw) as Sender[];
  for (const s of list) if (!credentials().has(s.login.toLowerCase())) throw new Error(`no mailbox credential for ${s.login}`);
  return list;
}

function credentialOf(login: string): Credential {
  const c = credentials().get(login.toLowerCase());
  if (!c) throw new Error(`no mailbox credential for ${login}`);
  return c;
}

export interface OutgoingMail {
  from: Sender;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}

export async function sendMail(m: OutgoingMail): Promise<{ messageId: string; response: string }> {
  const c = credentialOf(m.from.login);
  const domain = m.from.address.split("@")[1]!;
  const messageId = `<${randomUUID()}@${domain}>`;
  const transport = nodemailer.createTransport({
    host: c.smtpHost,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: m.from.login, pass: c.appPassword },
  });
  try {
    const info = await transport.sendMail({
      from: { name: m.from.name, address: m.from.address },
      to: m.to,
      subject: m.subject,
      text: m.text,
      messageId,
      ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: [...(m.references ?? []), m.inReplyTo] } : {}),
      headers: { "X-Factory": "gtm-factory" },
    });
    if (info.rejected.length > 0) throw new Error(`refused by the server: ${info.response}`);
    return { messageId, response: info.response };
  } finally {
    transport.close();
  }
}

export interface IncomingMail {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  subject: string;
  date: string;
  text: string;
}

/** Messages in INBOX with a UID above `afterUid`, read without marking them seen. */
export async function readInbox(login: string, afterUid: number, max = 200): Promise<{ messages: IncomingMail[]; lastUid: number }> {
  const c = credentialOf(login);
  const client = new ImapFlow({ host: c.imapHost, port: 993, secure: true, auth: { user: login, pass: c.appPassword }, logger: false });
  client.on("error", (e: unknown) => console.warn(`[imap] ${login}: ${e instanceof Error ? e.message : String(e)}`));
  await client.connect();
  const out: IncomingMail[] = [];
  let lastUid = afterUid;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const uidNext = mailbox && typeof mailbox === "object" ? Number(mailbox.uidNext ?? 0) : 0;
      // First read: start from the newest messages only (nothing older can answer a factory email).
      const from = afterUid > 0 ? afterUid + 1 : Math.max(1, uidNext - 50);
      for await (const msg of client.fetch(`${from}:*`, { uid: true, envelope: true, source: true }, { uid: true })) {
        if (msg.uid <= afterUid) continue;
        lastUid = Math.max(lastUid, msg.uid);
        const parsed = msg.source ? await simpleParser(msg.source) : null;
        const refs = parsed?.references;
        out.push({
          uid: msg.uid,
          messageId: parsed?.messageId ?? msg.envelope?.messageId ?? null,
          inReplyTo: parsed?.inReplyTo ?? null,
          references: Array.isArray(refs) ? refs : refs ? [refs] : [],
          from: parsed?.from?.value?.[0]?.address ?? msg.envelope?.from?.[0]?.address ?? "",
          subject: parsed?.subject ?? msg.envelope?.subject ?? "",
          date: (parsed?.date ?? msg.envelope?.date ?? new Date()).toISOString(),
          text: (parsed?.text ?? "").slice(0, 20_000),
        });
        if (out.length >= max) break;
      }
      if (out.length === 0 && afterUid === 0) lastUid = Math.max(0, uidNext - 1);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return { messages: out, lastUid };
}

/** The text a person wrote, without the quoted thread under it (best effort, for the judge). */
export function topOfReply(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l) => /^>/.test(l) || /^On .+wrote:$/.test(l.trim()) || /^Le .+a écrit\s*:$/.test(l.trim()) || /^-----Original Message-----/.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim().slice(0, 4000);
}
