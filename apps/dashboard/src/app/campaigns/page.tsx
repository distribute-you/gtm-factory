import { Suspense } from "react";
import { CampaignsPage } from "@/components/pages/campaigns";
import { ApiCampaignsPage } from "@/components/api/campaigns";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiCampaignsPage /> : <CampaignsPage />}</Suspense>;
}
