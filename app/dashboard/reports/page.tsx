import { EmptyState, SellerPageHeader } from "../_components/seller-ui";

export default function SellerReportsPage() {
  return (
    <>
      <SellerPageHeader
        title="Reports"
        description="V1 reports stay focused on CSV exports for sales, customers, and inventory."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Reports screen scaffold"
          description="CSV exports can be generated from seller_order_management, seller_order_item_detail, seller_customer_summary, and seller_inventory_management."
        />
      </div>
    </>
  );
}

