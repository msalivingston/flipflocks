import { PoultryProductsOnePageForm } from "../poultry-products-one-page-form";

type ProcessedPoultryEditPageProps = {
  params: Promise<{
    processedPoultryItemId: string;
  }>;
};

export default async function ProcessedPoultryEditPage({
  params,
}: ProcessedPoultryEditPageProps) {
  const { processedPoultryItemId } = await params;

  return (
    <PoultryProductsOnePageForm
      initialProcessedPoultryItemId={processedPoultryItemId}
    />
  );
}
