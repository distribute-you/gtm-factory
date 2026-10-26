import { Suspense } from "react";
import { PinnedPage } from "@/components/pages/pinned";
import { ApiPinnedPage } from "@/components/api/pinned";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiPinnedPage /> : <PinnedPage />}</Suspense>;
}
