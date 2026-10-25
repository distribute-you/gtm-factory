import { Suspense } from "react";
import { LedgerPage } from "@/components/pages/ledger";

export default function Page() {
  return (
    <Suspense>
      <LedgerPage />
    </Suspense>
  );
}
