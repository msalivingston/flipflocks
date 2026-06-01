import { SellerPageHeader } from "../../_components/seller-ui";
import { NewManualOrder } from "./new-manual-order";

export default function NewManualOrderPage() {
  return (
    <>
      <SellerPageHeader
        eyebrow="Orders"
        title="New Order"
        description="Build a barn-side customer order from available inventory."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <NewManualOrder />
      </div>
    </>
  );
}
