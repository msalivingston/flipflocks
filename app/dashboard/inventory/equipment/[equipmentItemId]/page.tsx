import { EquipmentInventoryDetail } from "../equipment-detail";

export default async function SellerEquipmentInventoryDetailPage({
  params,
}: {
  params: Promise<{ equipmentItemId: string }>;
}) {
  const { equipmentItemId } = await params;

  return <EquipmentInventoryDetail equipmentItemId={equipmentItemId} />;
}
