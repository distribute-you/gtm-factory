import { Suspense } from "react";
import { ResearchPage } from "@/components/pages/research";

export default function Page() {
  return (
    <Suspense>
      <ResearchPage />
    </Suspense>
  );
}
