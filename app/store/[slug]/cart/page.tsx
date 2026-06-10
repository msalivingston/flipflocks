import {
  EmptyStorefront,
  StorefrontShell,
} from "../storefront-ui";
import { loadStorefrontChrome } from "../storefront-chrome-data";
import { StorefrontChrome } from "../storefront-shell-components";
import { CartPage } from "./cart-page";

export default async function StorefrontCartRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { categories, error, store } = await loadStorefrontChrome(slug);

  if (error) {
    return (
      <StorefrontShell>
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-7">
          <EmptyStorefront
            title="Cart could not load"
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
    <StorefrontChrome categories={categories} store={store}>
      <CartPage store={store} />
    </StorefrontChrome>
  );
}
