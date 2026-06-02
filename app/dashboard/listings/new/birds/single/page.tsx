import { SimpleListingForm } from "./single-breed-basics-form";

export default async function SimpleListingPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { draft } = await searchParams;

  return <SimpleListingForm draftListingBatchId={draft} />;
}
