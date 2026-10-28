/**
 * What a brand can connect, and what each one asks: one catalogue the page, a hosted server and
 * the demo all read. A host says which of them it has set up (`available`); this list never does.
 * Every account is READ once connected; nothing here sends.
 */

import type { ApiConnectChannel, ApiConnectField } from "./factory-api";

export const IMAP_FIELDS: ApiConnectField[] = [
  { id: "address", label: "Email address", placeholder: "you@company.com" },
  { id: "host", label: "IMAP server", placeholder: "imap.company.com", help: "In your mail settings, under IMAP. For Gmail it is imap.gmail.com." },
  { id: "port", label: "IMAP port", placeholder: "993", optional: true },
  { id: "user", label: "Login", placeholder: "Usually the email address", optional: true },
  { id: "password", label: "Password", secret: true, help: "For Gmail or Outlook, an app password from your account's security settings." },
  { id: "smtpHost", label: "SMTP server", placeholder: "smtp.company.com", optional: true, help: "Kept for sending later. Nothing is sent today." },
  { id: "smtpPort", label: "SMTP port", placeholder: "465", optional: true },
];

export const TOOL_IDS = ["gohighlevel", "posthog", "stripe", "clerk"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

const TOOL: Record<ToolId, { label: string; blurb: string; fields: ApiConnectField[] }> = {
  gohighlevel: {
    label: "GoHighLevel",
    blurb: "Read your contacts, kept up to date on their own.",
    fields: [
      { id: "token", label: "Private Integration Token", secret: true, placeholder: "pit-...", help: "In GoHighLevel: Settings, then Private Integrations. Create one and copy the token." },
      { id: "locationId", label: "Sub-account ID", placeholder: "ve9EPM428h8vShlRW1KT", help: "In GoHighLevel: Settings, then Business Profile. It is the Location ID." },
    ],
  },
  posthog: {
    label: "PostHog",
    blurb: "See who visited your site, by name, once they are identified.",
    fields: [
      { id: "token", label: "Personal API key", secret: true, placeholder: "phx_...", help: "In PostHog: Settings, then Personal API keys. Create one with the Query read scope." },
      { id: "projectId", label: "Project ID", placeholder: "171095", help: "In PostHog: Settings, then Project." },
      { id: "region", label: "Region", pickFrom: [{ value: "eu", label: "EU" }, { value: "us", label: "US" }], help: "eu.posthog.com is EU, app.posthog.com is US." },
    ],
  },
  stripe: {
    label: "Stripe",
    blurb: "See what each customer paid you.",
    fields: [{ id: "token", label: "Restricted key", secret: true, placeholder: "rk_live_...", help: "In Stripe: Developers, then API keys. Create a restricted key with Read on Customers and Charges." }],
  },
  clerk: {
    label: "Clerk",
    blurb: "See everyone who signed up to your product.",
    fields: [{ id: "token", label: "Secret key", secret: true, placeholder: "sk_live_...", help: "In Clerk: Configure, then API keys. Copy the Secret key of your production instance." }],
  },
};

export const toolFields = (t: ToolId): ApiConnectField[] => TOOL[t].fields;
export const toolLabel = (t: ToolId): string => TOOL[t].label;

/** Every channel, in the order the page lists them, each as if this host had set it up. */
export const CONNECT_CHANNELS: ApiConnectChannel[] = [
  { id: "gmail", label: "Gmail", accountChannel: "Email", blurb: "Read your Gmail inbox. Sign in with Google.", kind: "oauth", available: true },
  { id: "imap", label: "Any mailbox", accountChannel: "Email", blurb: "Read any mailbox with its login: Outlook, your own domain, others.", kind: "fields", fields: IMAP_FIELDS, available: true },
  { id: "whatsapp", label: "WhatsApp", accountChannel: "WhatsApp", blurb: "Read your WhatsApp chats. Scan a code with your phone, or type a pairing code.", kind: "bridge", methods: ["qr", "phone"], available: true },
  { id: "telegram", label: "Telegram", accountChannel: "Telegram", blurb: "Read your Telegram chats. Scan a code with your phone, or log in with your number.", kind: "bridge", methods: ["qr", "phone"], available: true },
  { id: "linkedin", label: "LinkedIn", accountChannel: "LinkedIn", blurb: "Read your LinkedIn messages. Log in with your email and password.", kind: "bridge", methods: ["password", "cookies"], available: true },
  ...TOOL_IDS.map((t): ApiConnectChannel => ({ id: t, label: TOOL[t].label, accountChannel: "CRM", blurb: TOOL[t].blurb, kind: "fields", fields: TOOL[t].fields, available: true })),
];
