"use client";

import { useState } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { AccountsTable } from "@/components/accounts-table";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { plural } from "@/lib/format";
import type { Model } from "@/lib/model";
import { useSim } from "@/lib/sim";

const CHANNELS = ["Email", "WhatsApp", "LinkedIn", "Telegram"];

/** The roles an account may carry: the values of the tactic scripts ask for. */
function rolesOf(model: Model): string[] {
  const t = model.catalogue.tactics.find((x) => x.id === "account_role");
  return t && t.type.kind === "list" ? t.type.values.map(String) : [];
}

export function AccountsPage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Connected accounts" }]} />
      <Page>{model ? <Accounts model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

function Accounts({ model }: { model: Model }) {
  const { scope, dispatch } = useSim();
  const brandId = scope ?? model.clients[0]?.brand.id ?? "";
  const accounts = model.session.accountsOf(brandId);
  const roles = rolesOf(model);
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title={<>{plural(accounts.length, "account", "accounts")} connected</>}
        sub="Give each mailbox and number a role. Messages go out from the role a campaign asks for, and every account is read."
        right={
          <button type="button" className="k-btn-strong" onClick={() => setOpen((v) => !v)}>
            <PlusIcon size={13} weight="bold" />
            Connect an account
          </button>
        }
      />
      {open && <ConnectForm roles={roles} onDone={() => setOpen(false)} onConnect={(account) => dispatch({ type: "connectAccount", brandId, account })} />}
      <AccountsTable rows={accounts} roles={roles} onRole={(id, role) => dispatch({ type: "accountRole", brandId, accountId: id, role })} />
    </>
  );
}

/** In the simulator, connecting is a form; a running GTM Factory sends you to its own connect page. */
function ConnectForm({ roles, onConnect, onDone }: { roles: string[]; onConnect: (a: { id: string; channel: string; address: string; role: string; status: "connected" }) => string | null; onDone: () => void }) {
  const [channel, setChannel] = useState(CHANNELS[0]!);
  const [address, setAddress] = useState("");
  const [role, setRole] = useState(roles[roles.length - 1] ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="k-card mb-4 flex flex-wrap items-end gap-3 p-4" data-testid="connect-form">
      <label className="flex flex-col gap-1">
        <span className="k-label">Channel</span>
        <select className="k-input px-1.5" style={{ font: "inherit" }} value={channel} onChange={(e) => setChannel(e.target.value)}>
          {CHANNELS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[220px] flex-1 flex-col gap-1">
        <span className="k-label">Address or number</span>
        <input className="k-input px-2" style={{ font: "inherit" }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={channel === "Email" ? "name@yourdomain.com" : "+44 7700 900000"} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="k-label">Role</span>
        <select className="k-input px-1.5" style={{ font: "inherit" }} value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="k-btn-strong"
        disabled={!address.trim()}
        onClick={() => {
          const err = onConnect({ id: `${channel.toLowerCase()}-${address.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, channel, address: address.trim(), role, status: "connected" });
          setError(err);
          if (!err) onDone();
        }}
      >
        Connect
      </button>
      {error && <p className="w-full text-[12px] text-[var(--data-rose)]">{error}</p>}
    </div>
  );
}
