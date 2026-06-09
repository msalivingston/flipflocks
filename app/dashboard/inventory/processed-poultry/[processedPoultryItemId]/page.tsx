import { ProcessedPoultryInventoryDetail } from "../processed-poultry-detail";

export default async function SellerProcessedPoultryInventoryDetailPage({
  params,
}: {
  params: Promise<{ processedPoultryItemId: string }>;
}) {
  const { processedPoultryItemId } = await params;

  return (
    <ProcessedPoultryInventoryDetail
      processedPoultryItemId={processedPoultryItemId}
    />
  );
}
