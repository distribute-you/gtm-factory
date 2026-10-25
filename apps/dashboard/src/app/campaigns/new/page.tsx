import { Suspense } from "react";
import { NewCampaignPage } from "@/components/pages/new-campaign";

export default function Page() {
  return (
    <Suspense>
      <NewCampaignPage />
    </Suspense>
  );
}
