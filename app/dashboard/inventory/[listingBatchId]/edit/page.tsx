import { LiveBirdsListingForm } from "../../add-v2/live-birds/page";

export default async function EditLiveBirdsListingPage({
  params,
}: {
  params: Promise<{ listingBatchId: string }>;
}) {
  const { listingBatchId } = await params;

  return <LiveBirdsListingForm listingBatchId={listingBatchId} mode="edit" />;
}
