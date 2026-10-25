import { Suspense } from "react";
import { LeadsPage } from "@/components/pages/leads";

export default function Page() {
  return (
    <Suspense>
      <LeadsPage />
    </Suspense>
  );
}
