import { Suspense } from "react";
import { ApiTodayPage } from "@/components/api/today";

export default function Page() {
  return <Suspense>
      <ApiTodayPage />
    </Suspense>;
}
