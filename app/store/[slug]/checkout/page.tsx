import {
  EmptyStorefront,
  StorefrontShell,
} from "../storefront-ui";
import { loadStorefrontChrome } from "../storefront-chrome-data";
import { StorefrontChrome } from "../storefront-shell-components";
import { CheckoutPage } from "./checkout-page";
import {
  resolveEmbeddedOrderModeContext,
  type EmbeddedOrderModeSearchParams,
} from "@/lib/embedded-order-mode";

export default async function StorefrontCheckoutRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<EmbeddedOrderModeSearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { categories, error, store } = await loadStorefrontChrome(slug);

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

  const orderMode = resolveEmbeddedOrderModeContext({
    searchParams: query,
    storeSlug: store.store_slug,
    websiteUrl: store.website_url,
  });

  return (
    <StorefrontChrome
      categories={categories}
      checkoutMode
      orderMode={orderMode}
      store={store}
    >
      <CheckoutPage orderMode={orderMode} store={store} />
    </StorefrontChrome>
  );
}
