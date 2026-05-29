import { SellerPageHeader } from "../_components/seller-ui";
import { CustomersList } from "./customers-list";

export default function SellerCustomersPage() {
  return (
    <>
      <SellerPageHeader
        title="Customers"
        description="Look up customer contact details and recent order history."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <CustomersList />
      </div>
    </>
  );
}
