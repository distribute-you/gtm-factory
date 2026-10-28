import { Suspense } from "react";
import { TodayPage } from "@/components/pages/today";
import { ApiTodayPage } from "@/components/api/today";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiTodayPage /> : <TodayPage />}</Suspense>;
}
