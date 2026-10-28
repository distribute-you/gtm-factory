"use client";

import { PlusIcon } from "@phosphor-icons/react";
import type { ApiConnectedAccount } from "@gtm-factory/core";
import { AccountsTable } from "@/components/accounts-table";
import { EmptyNote, Page, PageHeader, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview, useScope } from "@/lib/api/overview";
import { plural } from "@/lib/format";
import { Read } from "./common";

/** The brand's connected accounts, as the running GTM Factory serves them. Connecting happens on the host's own page. */
export function ApiAccountsPage() {
  const { scope } = useScope();
  const { data: o } = useOverview();
  const read = useApi<ApiConnectedAccount[]>(scope.brandId ? `/accounts?brandId=${encodeURIComponent(scope.brandId)}` : null);
  const tactic = o?.catalogue.tactics.find((t) => t.id === "account_role");
  const roles = tactic && tactic.type.kind === "list" ? tactic.type.values.map(String) : [];
  const connect = async () => {
    const { url } = await apiSend<{ url: string }>("POST", "/accounts/connect", { brandId: scope.brandId, role: roles[roles.length - 1] ?? null });
    window.location.href = url;
  };
  return (
    <>
      <TopBar crumbs={[{ label: "Connected accounts" }]} />
      <Page>
        {!scope.brandId ? (
          <EmptyNote>Pick a brand at the top to see its accounts.</EmptyNote>
        ) : (
          <Read read={read}>
            {(accounts) => (
              <>
                <PageHeader
                  title={<>{plural(accounts.length, "account", "accounts")} connected</>}
                  sub="Give each mailbox and number a role. Messages go out from the role a campaign asks for, and every account is read."
                  right={
                    <button type="button" className="k-btn-strong" onClick={connect}>
                      <PlusIcon size={13} weight="bold" />
                      Connect an account
                    </button>
                  }
                />
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
                />
              </>
            )}
          </Read>
        )}
      </Page>
    </>
  );
}
