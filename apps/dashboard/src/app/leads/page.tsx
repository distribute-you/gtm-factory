import { Suspense } from "react";
import { LeadsPage } from "@/components/pages/leads";
import { ApiLeadsPage } from "@/components/api/leads";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiLeadsPage /> : <LeadsPage />}</Suspense>;
}
