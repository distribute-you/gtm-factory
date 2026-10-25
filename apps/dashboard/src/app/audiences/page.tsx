import { Suspense } from "react";
import { AudiencesPage } from "@/components/pages/audiences";

export default function Page() {
  return (
    <Suspense>
      <AudiencesPage />
    </Suspense>
  );
}
