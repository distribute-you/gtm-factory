import { Suspense } from "react";
import { AudiencesPage } from "@/components/pages/audiences";
import { NotHere } from "@/components/api/elsewhere";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <NotHere api /> : <AudiencesPage />}</Suspense>;
}
