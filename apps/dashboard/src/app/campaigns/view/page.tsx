import { Suspense } from "react";
import { CampaignPage } from "@/components/pages/campaigns";
import { ApiCampaignPage } from "@/components/api/campaigns";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiCampaignPage /> : <CampaignPage />}</Suspense>;
}
