import { PrimaryActionLink, SellerPageHeader } from "../_components/seller-ui";
import { InventoryManagement } from "./inventory-management";

export default function SellerInventoryPage() {
  return (
    <>
      <SellerPageHeader
        title="Inventory"
        description="Manage birds and equipment with filters, sorting, and quick edits."
        action={
          <PrimaryActionLink href="/dashboard/inventory/add-v2">
            Add Inventory
          </PrimaryActionLink>
        }
      />
      <div className="mx-auto w-full px-4 py-4 lg:px-5">
        <InventoryManagement />
      </div>
    </>
  );
}
