import Link from "next/link";
import { SellerPageHeader } from "../_components/seller-ui";
import { OrdersList } from "./orders-list";

export default function SellerOrdersPage() {
  return (
    <>
      <SellerPageHeader
        title="Orders"
        description="Review pickup requests by status and open each order for next steps."
        action={
          <Link className="seller-primary-button gap-2" href="/dashboard/orders/new">
            <span aria-hidden="true" className="text-xl leading-none">
              +
            </span>
            Create manual order
          </Link>
        }
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <OrdersList />
      </div>
    </>
  );
}
