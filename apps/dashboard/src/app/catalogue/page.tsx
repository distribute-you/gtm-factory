import { Suspense } from "react";
import { CataloguePage } from "@/components/pages/catalogue";
import { ApiCataloguePage } from "@/components/api/catalogue";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiCataloguePage /> : <CataloguePage />}</Suspense>;
}
