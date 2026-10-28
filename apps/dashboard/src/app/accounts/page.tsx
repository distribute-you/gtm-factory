import { Suspense } from "react";
import { AccountsPage } from "@/components/pages/accounts";
import { ApiAccountsPage } from "@/components/api/accounts";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiAccountsPage /> : <AccountsPage />}</Suspense>;
}
