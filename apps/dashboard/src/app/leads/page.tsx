import { Suspense } from "react";
import { ApiLeadsPage } from "@/components/api/leads";

export default function Page() {
  return <Suspense>
      <ApiLeadsPage />
    </Suspense>;
}
