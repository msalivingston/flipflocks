import Link from "next/link";
import { SellerPageHeader } from "../_components/seller-ui";
import { InventoryManagement } from "./inventory-management";

export default function SellerInventoryPage() {
  return (
    <>
      <SellerPageHeader
        title="Inventory"
        description="Manage birds and equipment with filters, sorting, and quick edits."
        action={
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
            href="/dashboard/inventory/add-v2"
          >
            + Add Inventory
          </Link>
        }
      />
      <div className="mx-auto w-full px-4 py-4 lg:px-5">
        <InventoryManagement />
      </div>
    </>
  );
}
