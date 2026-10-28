import { Suspense } from "react";
import { ApiAccountsPage } from "@/components/api/accounts";

export default function Page() {
  return <Suspense>
      <ApiAccountsPage />
    </Suspense>;
}
