import { Suspense } from "react";
import { CampaignsPage } from "@/components/pages/campaigns";

export default function Page() {
  return (
    <Suspense>
      <CampaignsPage />
    </Suspense>
  );
}
