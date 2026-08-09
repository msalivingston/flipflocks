import {
  EmptyStorefront,
  StorefrontShell,
} from "../storefront-ui";
import { loadStorefrontChrome } from "../storefront-chrome-data";
import { StorefrontChrome } from "../storefront-shell-components";
import { CheckoutPage } from "./checkout-page";
import { notFound, redirect } from "next/navigation";
import {
  type EmbeddedOrderModeSearchParams,
} from "@/lib/embedded-order-mode";
import { loadStorefrontAccess } from "../storefront-data";
import { resolveStorefrontVisibilityDecision } from "@/lib/storefront-visibility";

export default async function StorefrontCheckoutRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<EmbeddedOrderModeSearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [{ categories, error, store }, accessResult] = await Promise.all([
    loadStorefrontChrome(slug),
    loadStorefrontAccess(slug),
  ]);

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

  if (accessResult.error || !accessResult.data) notFound();

  const visibilityDecision = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: accessResult.data.is_publicly_available,
    searchParams: query,
    storeSlug: store.store_slug,
    visibility: accessResult.data.storefront_visibility,
    websiteUrl: accessResult.data.website_url,
  });
  if (visibilityDecision.action === "redirect") redirect(visibilityDecision.url);
  if (visibilityDecision.action === "deny") notFound();
  const orderMode = visibilityDecision.orderMode;

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
