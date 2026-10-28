import { Suspense } from "react";
import { ApiBrandsPage } from "@/components/api/brands";

export default function Page() {
  return <Suspense>{<ApiBrandsPage />}</Suspense>;
}
