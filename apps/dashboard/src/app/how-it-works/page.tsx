import { Suspense } from "react";
import { HowItWorksPage } from "@/components/how-it-works";

export default function Page() {
  return (
    <Suspense>
      <HowItWorksPage />
    </Suspense>
  );
}
