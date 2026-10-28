import { Suspense } from "react";
import { TeamPage } from "@/components/pages/team";
import { ApiTeamPage } from "@/components/api/team";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiTeamPage /> : <TeamPage />}</Suspense>;
}
