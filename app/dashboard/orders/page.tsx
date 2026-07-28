import Link from "next/link";
import { SellerPageHeader } from "../_components/seller-ui";
import { OrdersList } from "./orders-list";

export default function SellerOrdersPage() {
  return (
    <>
      <SellerPageHeader
        title="Orders"
        action={
          <Link
            className="absolute right-5 top-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-800 px-4 text-sm font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 lg:static xl:min-h-10"
            href="/dashboard/orders/new"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              +
            </span>
            <span className="xl:hidden">New Order</span>
            <span className="hidden xl:inline">Create manual order</span>
          </Link>
        }
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <OrdersList />
      </div>
    </>
  );
}
