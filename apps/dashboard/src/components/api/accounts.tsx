"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlusIcon } from "@phosphor-icons/react";
import type { ApiConnectChannel, ApiConnectedAccount } from "@gtm-factory/core";
import { AccountsTable } from "@/components/accounts-table";
import { ConnectDrawer } from "@/components/connect-drawer";
import { EmptyNote, Page, PageHeader, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview, useScope } from "@/lib/api/overview";
import { plural } from "@/lib/format";
import { Read } from "./common";

/** The brand's connected accounts: connect one, give each a role, see what each read. */
export function ApiAccountsPage() {
  const { scope } = useScope();
  const { data: o } = useOverview();
  const search = useSearchParams();
  const read = useApi<ApiConnectedAccount[]>(scope.brandId ? `/accounts?brandId=${encodeURIComponent(scope.brandId)}` : null);
  const channels = useApi<ApiConnectChannel[]>("/connect/channels", 60_000);
  const tactic = o?.catalogue.tactics.find((t) => t.id === "account_role");
  const roles = tactic && tactic.type.kind === "list" ? tactic.type.values.map(String) : [];
  const [connecting, setConnecting] = useState(false);
  const back = search.get("connect");
  const backAccount = search.get("account");
  return (
    <>
      <TopBar crumbs={[{ label: "Connected accounts" }]} />
      <Page>
        {!scope.brandId ? (
          <EmptyNote>Pick a brand at the top to see its accounts.</EmptyNote>
        ) : (
          <Read read={read}>
            {(accounts) => {
              const returned = backAccount ? accounts.find((a) => a.id === backAccount) : undefined;
              return (
                <>
                  <PageHeader
                    title={<>{plural(accounts.filter((a) => a.status === "connected").length, "account", "accounts")} connected</>}
                    sub="Connect your mailboxes and numbers, and give each a role. Every account is read; messages will go out from the role a campaign asks for."
                    right={
                      <button type="button" className="k-btn-strong" disabled={!channels.data} onClick={() => setConnecting(true)}>
                        <PlusIcon size={13} weight="bold" />
                        Connect an account
                      </button>
                    }
                  />
                  {returned && <p className="mb-3 text-[13px]">{returned.status === "connected" ? `${returned.address} is connected.` : `${returned.channel} is not connected: ${returned.error ?? "the sign-in did not finish."}`}</p>}
                  {back === "expired" && <p className="mb-3 text-[13px] text-[var(--data-rose)]">That sign-in had expired. Connect the account again.</p>}
                  {back === "failed" && <p className="mb-3 text-[13px] text-[var(--data-rose)]">The sign-in did not finish. Connect the account again.</p>}
                  <AccountsTable
                    rows={accounts}
                    roles={roles}
                    onRole={async (id, role) => {
                      try {
                        await apiSend("PATCH", `/accounts/${encodeURIComponent(id)}`, { role });
                        return null;
                      } catch (e) {
                        return e instanceof Error ? e.message : String(e);
                      }
                    }}
                    onDisconnect={async (id) => {
                      try {
                        await apiSend("DELETE", `/accounts/${encodeURIComponent(id)}`);
                        return null;
                      } catch (e) {
                        return e instanceof Error ? e.message : String(e);
                      }
                    }}
                  />
                  {connecting && channels.data && <ConnectDrawer brandId={scope.brandId!} roles={roles} channels={channels.data} onClose={() => setConnecting(false)} />}
                </>
              );
            }}
          </Read>
        )}
      </Page>
    </>
  );
}
