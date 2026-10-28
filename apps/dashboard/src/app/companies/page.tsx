import { Suspense } from "react";
import { CompaniesPage } from "@/components/pages/leads";
import { NotHere } from "@/components/api/elsewhere";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <NotHere api /> : <CompaniesPage />}</Suspense>;
}
