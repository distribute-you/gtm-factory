import { Suspense } from "react";
import { LeadPage } from "@/components/pages/leads";
import { ApiLeadPage } from "@/components/api/leads";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiLeadPage /> : <LeadPage />}</Suspense>;
}
