import { Suspense } from "react";
import { ApiCampaignsPage } from "@/components/api/campaigns";

export default function Page() {
  return <Suspense>
      <ApiCampaignsPage />
    </Suspense>;
}
