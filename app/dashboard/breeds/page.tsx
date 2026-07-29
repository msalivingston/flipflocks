import { SellerPageHeader } from "../_components/seller-ui";
import { BreedsManagement } from "./breeds-management";

export default function SellerBreedsPage() {
  return (
    <>
      <div className="hidden lg:block">
        <SellerPageHeader
          title="Breeds"
          description="Build the breed list for your storefront."
        />
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-5 lg:px-7 lg:py-5">
        <BreedsManagement />
      </div>
    </>
  );
}
