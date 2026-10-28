import { Suspense } from "react";
import { ApiAudiencesPage } from "@/components/api/audiences";

export default function Page() {
  return (
    <Suspense>
      <ApiAudiencesPage />
    </Suspense>
  );
}
