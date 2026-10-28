import { Suspense } from "react";
import { ApiTeamPage } from "@/components/api/team";

export default function Page() {
  return <Suspense>
      <ApiTeamPage />
    </Suspense>;
}
