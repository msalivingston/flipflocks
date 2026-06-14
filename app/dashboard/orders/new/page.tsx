import { SellerPageHeader } from "../../_components/seller-ui";
import { NewManualOrder } from "./new-manual-order";

export default function NewManualOrderPage() {
  return (
    <>
      <SellerPageHeader
        eyebrow="Orders"
        title="New Order"
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
        <NewManualOrder />
      </div>
    </>
  );
}
