import { redirect } from "next/navigation";

export default async function SellerListingDetailPage({
  params,
}: {
  params: Promise<{ listingBatchId: string }>;
}) {
  const { listingBatchId } = await params;

  redirect(`/dashboard/inventory/${listingBatchId}/edit`);
}
