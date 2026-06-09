import { SellerPageHeader } from "../_components/seller-ui";
import { BreedsManagement } from "./breeds-management";

export default function SellerBreedsPage() {
  return (
    <>
      <SellerPageHeader
        title="Breeds"
        description="Manage the breeds you raise and use on your storefront."
        action={<BreedsHeaderAction />}
      />
      <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-7">
        <BreedsManagement />
      </div>
    </>
  );
}

function BreedsHeaderAction() {
  return (
    <button
      className="seller-primary-button"
      data-breeds-add-trigger
      type="button"
    >
      Add Breed
    </button>
  );
}
