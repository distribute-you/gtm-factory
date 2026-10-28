import { Suspense } from "react";
import { ApiCompaniesPage } from "@/components/api/companies";

export default function Page() {
  return (
    <Suspense>
      <ApiCompaniesPage />
    </Suspense>
  );
}
