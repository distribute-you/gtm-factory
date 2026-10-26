import { Suspense } from "react";
import { ApiNewBrandPage } from "@/components/api/brands";
import { NotHere } from "@/components/api/elsewhere";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiNewBrandPage /> : <NotHere api={false} />}</Suspense>;
}
