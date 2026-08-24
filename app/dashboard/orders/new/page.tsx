import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SellerPageHeader } from "../../_components/seller-ui";
import { NewManualOrder } from "./new-manual-order";

export default async function NewManualOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ restore_from?: string | string[] }>;
}) {
  const params = await searchParams;
  const restoreFromOrderId =
    typeof params.restore_from === "string" ? params.restore_from : null;

  return (
    <>
      <div className="hidden lg:block">
        <SellerPageHeader
          eyebrow="Orders"
          title="New Order"
          action={
            <div className="hidden h-20 w-48 shrink-0 overflow-hidden lg:block xl:h-24 xl:w-60">
              <Image
                src="/manual-order-phone-turkey.png"
                alt=""
                width={260}
                height={188}
                className="h-full w-full object-contain opacity-60"
                priority
              />
            </div>
          }
        />
      </div>
      <header className="flex items-center border-b border-stone-200/80 bg-white px-4 py-3 lg:hidden">
        <Link
          aria-label="Back to Orders"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
          href="/dashboard/orders"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 pr-11 text-center text-2xl font-bold text-stone-950">
          New Order
        </h1>
      </header>
      <div className="mx-auto w-full max-w-7xl px-3 py-3 sm:px-5 lg:px-7 lg:py-4">
        <NewManualOrder restoreFromOrderId={restoreFromOrderId} />
      </div>
    </>
  );
}
