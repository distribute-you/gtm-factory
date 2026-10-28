import { Suspense } from "react";
import { ResearchPage } from "@/components/pages/research";
import { ApiResearchPage } from "@/components/api/research";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiResearchPage /> : <ResearchPage />}</Suspense>;
}
