import { DashboardPageContent, SellerPageHeader } from "../_components/seller-ui";
import { CustomersList } from "./customers-list";

export default function SellerCustomersPage() {
  return (
    <>
      <SellerPageHeader
        title="Customers"
        description="Look up customer contact details and recent order history."
      />
      <DashboardPageContent>
        <CustomersList />
      </DashboardPageContent>
    </>
  );
}
