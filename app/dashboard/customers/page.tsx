import { EmptyState, SellerPageHeader } from "../_components/seller-ui";

export default function SellerCustomersPage() {
  return (
    <>
      <SellerPageHeader
        title="Customers"
        description="Read-mostly customer lookup with call, text, email, notes, and recent order context."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Customers screen scaffold"
          description="Customer list and detail screens can use seller_customer_summary, seller_customer_detail, and seller_update_customer without a new backend layer."
        />
      </div>
    </>
  );
}

