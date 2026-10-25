import { Suspense } from "react";
import { PinnedPage } from "@/components/pages/pinned";

export default function Page() {
  return (
    <Suspense>
      <PinnedPage />
    </Suspense>
  );
}
