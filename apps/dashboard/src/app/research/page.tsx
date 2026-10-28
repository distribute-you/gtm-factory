import { Suspense } from "react";
import { ApiResearchPage } from "@/components/api/research";

export default function Page() {
  return <Suspense>
      <ApiResearchPage />
    </Suspense>;
}
