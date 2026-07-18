import { SellerPageHeader } from "../_components/seller-ui";
import { BreedsManagement } from "./breeds-management";

export default function SellerBreedsPage() {
  return (
    <>
      <SellerPageHeader
        title="Breeds"
        description="Build the breed list for your storefront."
      />
      <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-7">
        <BreedsManagement />
      </div>
    </>
  );
}
