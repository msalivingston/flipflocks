import { ListingDetail } from "./listing-detail";

export default async function SellerListingDetailPage({
  params,
}: {
  params: Promise<{ listingBatchId: string }>;
}) {
  const { listingBatchId } = await params;

  return <ListingDetail listingBatchId={listingBatchId} />;
}
