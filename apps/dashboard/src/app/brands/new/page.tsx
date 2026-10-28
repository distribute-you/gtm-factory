import { Suspense } from "react";
import { ApiNewBrandPage } from "@/components/api/brands";

export default function Page() {
  return <Suspense>{<ApiNewBrandPage />}</Suspense>;
}
