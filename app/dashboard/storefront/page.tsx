import { EmptyState, SellerPageHeader } from "../_components/seller-ui";

export default function SellerStorefrontPage() {
  return (
    <>
      <SellerPageHeader
        title="Storefront"
        description="Manage saved public storefront text, contact details, pickup information, and preview links."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Storefront screen scaffold"
          description="Text settings and saved public preview are ready. Logo and banner should use the Group 32B media upload and management contracts when this screen is implemented."
        />
      </div>
    </>
  );
}

