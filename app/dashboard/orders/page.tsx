import { SellerPageHeader } from "../_components/seller-ui";
import { OrdersList } from "./orders-list";

export default function SellerOrdersPage() {
  return (
    <>
      <SellerPageHeader
        title="Orders"
        description="Review storefront pickup requests and contact buyers to coordinate pickup."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <OrdersList />
      </div>
    </>
  );
}
