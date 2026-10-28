import { Suspense } from "react";
import { ApiCampaignPage } from "@/components/api/campaigns";

export default function Page() {
  return <Suspense>
      <ApiCampaignPage />
    </Suspense>;
}
