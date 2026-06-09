import { BreedDetail } from "../breed-detail";

export default async function SellerBreedDetailPage({
  params,
}: {
  params: Promise<{ breedProfileId: string }>;
}) {
  const { breedProfileId } = await params;

  return <BreedDetail breedProfileId={breedProfileId} />;
}
