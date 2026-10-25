import { Suspense } from "react";
import { LeadPage } from "@/components/pages/leads";

export default function Page() {
  return (
    <Suspense>
      <LeadPage />
    </Suspense>
  );
}
