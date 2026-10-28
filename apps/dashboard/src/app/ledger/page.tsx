import { Suspense } from "react";
import { ApiLedgerPage } from "@/components/api/ledger";

export default function Page() {
  return <Suspense>
      <ApiLedgerPage />
    </Suspense>;
}
