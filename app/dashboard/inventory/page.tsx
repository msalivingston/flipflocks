import { PrimaryActionLink, SellerPageHeader } from "../_components/seller-ui";
import { InventoryManagement } from "./inventory-management";

export default function SellerInventoryPage() {
  return (
    <>
      <SellerPageHeader
        title="Inventory"
        description="Manage availability by breed, with editable rows for each type, age, quantity, price, and status."
        action={
          <PrimaryActionLink href="/dashboard/listings/new">
            Add Inventory
          </PrimaryActionLink>
        }
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <InventoryManagement />
      </div>
    </>
  );
}
