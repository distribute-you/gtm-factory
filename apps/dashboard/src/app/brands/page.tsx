import { Suspense } from "react";
import { ApiBrandsPage } from "@/components/api/brands";
import { NotHere } from "@/components/api/elsewhere";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiBrandsPage /> : <NotHere api={false} />}</Suspense>;
}
