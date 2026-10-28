import { Suspense } from "react";
import { ApiLeadPage } from "@/components/api/leads";

export default function Page() {
  return <Suspense>
      <ApiLeadPage />
    </Suspense>;
}
