import { InventoryDetail } from "../inventory-detail";

export default async function SellerInventoryDetailPage({
  params,
}: {
  params: Promise<{ listingBatchId: string }>;
}) {
  const { listingBatchId } = await params;

  return <InventoryDetail listingBatchId={listingBatchId} />;
}
