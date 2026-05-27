import { EmptyState, SellerPageHeader } from "../_components/seller-ui";

export default function SellerAccountPage() {
  return (
    <>
      <SellerPageHeader
        title="Account"
        description="Security, billing visibility, notifications, and seller defaults."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Account screen scaffold"
          description="Seller defaults should use seller_store_defaults and seller_update_store_defaults. Billing should remain read-only until the Stripe flow is added."
        />
      </div>
    </>
  );
}

