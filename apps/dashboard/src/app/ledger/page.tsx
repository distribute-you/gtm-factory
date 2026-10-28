import { Suspense } from "react";
import { LedgerPage } from "@/components/pages/ledger";
import { ApiLedgerPage } from "@/components/api/ledger";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiLedgerPage /> : <LedgerPage />}</Suspense>;
}
