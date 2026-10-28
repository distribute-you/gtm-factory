"use client";

import { useState } from "react";
import { EnvelopeSimpleIcon, LinkedinLogoIcon, WhatsappLogoIcon, TelegramLogoIcon, PlugIcon } from "@phosphor-icons/react";
import { CardTable, EmptyNote, TD, TDN, TH, ToneDot } from "./ui";
import { formatCount } from "@/lib/format";

/** One connected account as both data sources show it. */
export interface AccountRow {
  id: string;
  channel: string;
  address: string;
  role: string;
  status: "connecting" | "connected" | "to_reconnect" | "failed";
  sentWeek: number;
  readWeek: number;
  error?: string | null;
}

const STATUS: Record<AccountRow["status"], React.ReactNode> = {
  connected: <ToneDot tone="run">Connected</ToneDot>,
  connecting: <ToneDot tone="accent">Connecting</ToneDot>,
  to_reconnect: <ToneDot tone="amber">Reconnect</ToneDot>,
  failed: <ToneDot tone="rose">Not connected</ToneDot>,
};

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  Email: <EnvelopeSimpleIcon size={16} weight="duotone" />,
  WhatsApp: <WhatsappLogoIcon size={16} weight="duotone" />,
  LinkedIn: <LinkedinLogoIcon size={16} weight="duotone" />,
  Telegram: <TelegramLogoIcon size={16} weight="duotone" />,
};

/**
 * The brand's connected accounts: one row each, its role editable in place.
 * Scripts ask for a role and pick the account themselves, so a role change
 * takes effect at the next run.
 */
export function AccountsTable({ rows, roles, onRole, onDisconnect }: { rows: AccountRow[]; roles: string[]; onRole: (id: string, role: string) => Promise<string | null> | string | null; onDisconnect?: (id: string) => Promise<string | null> }) {
  const sorted = [...rows].sort((a, b) => a.channel.localeCompare(b.channel) || a.role.localeCompare(b.role) || a.address.localeCompare(b.address));
  return (
    <CardTable note="Each account, its role, and how much it sent and read." footer="A script asks for a role, then picks one of the accounts with that role. Change a role here and the next run follows it.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={`${TH} w-full`}>Account</th>
          <th className={TH}>Channel</th>
          <th className={TH}>Role</th>
          <th className={TH}>Status</th>
          <th className={`${TH} text-right`}>Sent this week</th>
          <th className={`${TH} text-right`}>Read this week</th>
          {onDisconnect && <th className={TH} />}
        </tr>
      </thead>
      <tbody>
        {sorted.map((a) => (
          <tr key={a.id} className="k-row k-line-subtle border-b last:border-0" data-account={a.id}>
            <td className={TD}>
              <span className="flex items-center gap-2">
                <span className="k-fg2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-inset)]">{CHANNEL_ICON[a.channel] ?? <PlugIcon size={16} />}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.address || "New account"}</span>
                  {a.error && a.status !== "connected" && <span className="k-fg3 block truncate text-[12px]">{a.error}</span>}
                </span>
              </span>
            </td>
            <td className={TD}>{a.channel}</td>
            <td className={TD}>
              <RoleField value={a.role} roles={roles} onChange={(r) => onRole(a.id, r)} label={`Role of ${a.address}`} />
            </td>
            <td className={TD}>{STATUS[a.status]}</td>
            <td className={TDN}>{formatCount(a.sentWeek)}</td>
            <td className={TDN}>{formatCount(a.readWeek)}</td>
            {onDisconnect && (
              <td className={TD}>
                <DisconnectButton label={a.address || "this account"} onConfirm={() => onDisconnect(a.id)} />
              </td>
            )}
          </tr>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={onDisconnect ? 7 : 6}>
              <EmptyNote>No account connected yet. Connect a mailbox or a number to start.</EmptyNote>
            </td>
          </tr>
        )}
      </tbody>
    </CardTable>
  );
}

/** A role reads as text; a click opens the list; picking one saves it. */
function RoleField({ value, roles, onChange, label }: { value: string; roles: string[]; onChange: (role: string) => Promise<string | null> | string | null; label: string }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <select
        aria-label={label}
        className="k-input -ml-1.5 w-auto px-1.5"
        style={{ font: "inherit" }}
        value={saving ?? value}
        onChange={async (e) => {
          const role = e.target.value;
          setSaving(role);
          const err = await onChange(role);
          setError(err);
          setSaving(null);
        }}
      >
        {[...new Set([value, ...roles])].map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {error && <span className="mt-0.5 text-[11px] text-[var(--data-rose)]">{error}</span>}
    </span>
  );
}

/** Disconnect asks once: GTM Factory stops reading the account and forgets its login. */
function DisconnectButton({ label, onConfirm }: { label: string; onConfirm: () => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        className="k-btn-ghost whitespace-nowrap"
        onClick={async () => {
          if (!window.confirm(`Disconnect ${label}? GTM Factory stops reading it and forgets its login.`)) return;
          setError(await onConfirm());
        }}
      >
        Disconnect
      </button>
      {error && <span className="mt-0.5 text-[11px] text-[var(--data-rose)]">{error}</span>}
    </span>
  );
}
