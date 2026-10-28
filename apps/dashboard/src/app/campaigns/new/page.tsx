import { Suspense } from "react";
import { NewCampaignPage } from "@/components/pages/new-campaign";
import { ApiNewCampaignPage } from "@/components/api/new-campaign";
import { IS_API } from "@/lib/data-source";

export default function Page() {
  return <Suspense>{IS_API ? <ApiNewCampaignPage /> : <NewCampaignPage />}</Suspense>;
}
