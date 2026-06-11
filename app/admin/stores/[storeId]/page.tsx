import { AdminStoreDetail } from "../../_components/admin-store-detail";

export default async function AdminStoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;

  return <AdminStoreDetail storeId={storeId} />;
}
