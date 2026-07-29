import { DashboardPageContent, SellerPageHeader } from "../_components/seller-ui";
import { AddCustomerButton } from "./add-customer-modal";
import { CustomersList } from "./customers-list";

export default function SellerCustomersPage() {
  return (
    <>
      <div className="lg:hidden">
        <SellerPageHeader
          title="Customers"
          action={
            <AddCustomerButton
              className="absolute right-5 top-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-emerald-800 px-5 text-base font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
            >
              <span aria-hidden="true" className="text-xl leading-none">
                +
              </span>
              Add Customer
            </AddCustomerButton>
          }
        />
      </div>
      <div className="hidden lg:block">
        <SellerPageHeader
          title="Customers"
          description="Look up customer contact details and recent order history."
          action={
            <AddCustomerButton className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-emerald-800 px-5 text-base font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2">
              <span aria-hidden="true" className="text-xl leading-none">
                +
              </span>
              Add Customer
            </AddCustomerButton>
          }
        />
      </div>
      <DashboardPageContent className="px-4 py-4 sm:px-5 lg:px-7 lg:py-5">
        <CustomersList />
      </DashboardPageContent>
    </>
  );
}
