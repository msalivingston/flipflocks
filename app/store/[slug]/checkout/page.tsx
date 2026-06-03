import {
  EmptyStorefront,
  StorefrontFooter,
  StorefrontNav,
  StorefrontShell,
} from "../storefront-ui";
import { loadStorefrontHome } from "../storefront-data";
import { CheckoutPage } from "./checkout-page";

export default async function StorefrontCheckoutRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { data: store, error } = await loadStorefrontHome(slug);

  if (error) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="Checkout could not load"
            description="Please refresh the page or return to the storefront."
          />
        </main>
      </StorefrontShell>
    );
  }

  if (!store) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="Storefront not found"
            description="This storefront is not public right now."
          />
        </main>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />
      <CheckoutPage store={store} />
      <StorefrontFooter store={store} />
    </StorefrontShell>
  );
}
