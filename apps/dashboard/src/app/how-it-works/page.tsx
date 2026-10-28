import { Suspense } from "react";
import { HowItWorksPage } from "@/components/pages/how-it-works";

export default function Page() {
  return (
    <Suspense>
      <HowItWorksPage />
    </Suspense>
  );
}
