import { GroupListingForm } from "./batch-listing-form";

export default async function GroupListingPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { draft } = await searchParams;

  return <GroupListingForm draftListingBatchId={draft} />;
}
