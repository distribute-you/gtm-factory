import { Suspense } from "react";
import { ApiPinnedPage } from "@/components/api/pinned";

export default function Page() {
  return <Suspense>
      <ApiPinnedPage />
    </Suspense>;
}
