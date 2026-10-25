import { Suspense } from "react";
import { CampaignPage } from "@/components/pages/campaigns";

export default function Page() {
  return (
    <Suspense>
      <CampaignPage />
    </Suspense>
  );
}
