import Image from "next/image";
import { SellerPageHeader } from "../../_components/seller-ui";
import { NewManualOrder } from "./new-manual-order";

export default function NewManualOrderPage() {
  return (
    <>
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
      <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
        <NewManualOrder />
      </div>
    </>
  );
}
