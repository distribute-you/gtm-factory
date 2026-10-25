import { Suspense } from "react";
import { CompaniesPage } from "@/components/pages/leads";

export default function Page() {
  return (
    <Suspense>
      <CompaniesPage />
    </Suspense>
  );
}
