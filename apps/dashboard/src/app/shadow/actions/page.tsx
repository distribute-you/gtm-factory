import { Suspense } from "react";
import { ShadowActionsPage } from "@/components/pages/shadow";

export default function Page() {
  return (
    <Suspense>
      <ShadowActionsPage />
    </Suspense>
  );
}
