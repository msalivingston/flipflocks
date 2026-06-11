import { AdminBreedsList } from "../_components/admin-breeds-list";

export default async function AdminBreedsPage({
  searchParams,
}: {
  searchParams: Promise<{ image?: string }>;
}) {
  const params = await searchParams;
  const initialImageFilter = params.image === "missing" ? "missing" : "all";

  return <AdminBreedsList initialImageFilter={initialImageFilter} />;
}
