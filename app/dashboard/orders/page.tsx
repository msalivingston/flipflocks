import { EmptyState, SellerPageHeader } from "../_components/seller-ui";

export default function SellerOrdersPage() {
  return (
    <>
      <SellerPageHeader
        title="Orders"
        description="Coordinate pay-at-pickup orders, pickup options, and customer contact."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Orders screen scaffold"
          description="The dashboard already proves recent order reads and contact action components. Full order lists and detail pages should build on seller_order_management and seller_order_item_detail."
        />
      </div>
    </>
  );
}

