import Link from "next/link";
import { SellerPageHeader } from "../_components/seller-ui";
import { InventoryManagement } from "./inventory-management";

export default function SellerInventoryPage() {
  return (
    <>
      <SellerPageHeader
        title="Inventory"
        action={
          <Link
            className="absolute right-5 top-5 inline-flex min-h-12 items-center justify-center rounded-md bg-emerald-800 px-5 text-base font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 lg:static lg:min-h-10 lg:px-4 lg:text-sm"
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
