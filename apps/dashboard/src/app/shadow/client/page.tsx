import { Suspense } from "react";
import { ShadowClientPage } from "@/components/pages/shadow";

export default function Page() {
  return (
    <Suspense>
      <ShadowClientPage />
    </Suspense>
  );
}
