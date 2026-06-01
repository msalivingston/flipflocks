import { SellerPageHeader } from "../_components/seller-ui";
import { InventoryManagement } from "./inventory-management";

export default function SellerInventoryPage() {
  return (
    <>
      <SellerPageHeader
        title="Inventory"
        description="See what birds are available now and make safe quantity edits without leaving the dashboard."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <InventoryManagement />
      </div>
    </>
  );
}
