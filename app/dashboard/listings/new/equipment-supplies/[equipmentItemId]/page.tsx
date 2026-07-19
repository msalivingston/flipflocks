import { EquipmentSuppliesOnePageForm } from "../equipment-supplies-one-page-form";

type EquipmentSuppliesEditPageProps = {
  params: Promise<{
    equipmentItemId: string;
  }>;
};

export default async function EquipmentSuppliesEditPage({
  params,
}: EquipmentSuppliesEditPageProps) {
  const { equipmentItemId } = await params;

  return <EquipmentSuppliesOnePageForm initialEquipmentItemId={equipmentItemId} />;
}
