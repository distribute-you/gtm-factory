import { Suspense } from "react";
import { ApiNewCampaignPage } from "@/components/api/new-campaign";

export default function Page() {
  return <Suspense>
      <ApiNewCampaignPage />
    </Suspense>;
}
