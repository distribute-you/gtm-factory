import { Suspense } from "react";
import { CataloguePage } from "@/components/pages/catalogue";

export default function Page() {
  return (
    <Suspense>
      <CataloguePage />
    </Suspense>
  );
}
