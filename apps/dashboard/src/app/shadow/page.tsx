import { Suspense } from "react";
import { ShadowHomePage } from "@/components/pages/shadow";

export default function Page() {
  return (
    <Suspense>
      <ShadowHomePage />
    </Suspense>
  );
}
