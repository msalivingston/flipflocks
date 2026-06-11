import { AdminBreedImageManager } from "../../_components/admin-breed-image-manager";

export default async function AdminBreedDetailPage({
  params,
}: {
  params: Promise<{ breedId: string }>;
}) {
  const { breedId } = await params;

  return <AdminBreedImageManager breedId={breedId} />;
}
