import { Suspense } from "react";
import { ApiCataloguePage } from "@/components/api/catalogue";

export default function Page() {
  return <Suspense>
      <ApiCataloguePage />
    </Suspense>;
}
