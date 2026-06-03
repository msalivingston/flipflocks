import {
  EmptyStorefront,
  InfoPanel,
  StorefrontFooter,
  StorefrontNav,
  StorefrontShell,
  formatLocation,
} from "../storefront-ui";
import { loadStorefrontHome } from "../storefront-data";

export default async function StorefrontPoliciesPage({
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
            title="This page could not load"
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

      <main className="mx-auto grid max-w-6xl gap-7 px-5 py-7 sm:px-7">
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
            Pickup and policies
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-950">
            Buying from {store.store_name}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
            Review pickup details and seller policies before requesting an
            order. The seller will confirm final timing after your request is
            sent.
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="grid gap-4">
            <PolicySection title="Pickup instructions">
              {store.pickup_instructions || "Pickup instructions coming soon."}
            </PolicySection>
            <PolicySection title="Pickup policy">
              {store.pickup_policy || "Pickup policy details coming soon."}
            </PolicySection>
            <PolicySection title="Cancellation policy">
              {store.cancellation_policy ||
                "Cancellation policy details coming soon."}
            </PolicySection>
          </div>

          <aside className="grid h-fit gap-4">
            <InfoPanel title="Pickup region">
              <p>{formatLocation(store)}</p>
            </InfoPanel>
            <InfoPanel title="Contact">
              {store.public_email ? <p>Email: {store.public_email}</p> : null}
              {store.public_phone ? <p>Phone: {store.public_phone}</p> : null}
              {!store.public_email && !store.public_phone ? (
                <p>The seller will follow up after your order is placed.</p>
              ) : null}
            </InfoPanel>
          </aside>
        </section>
      </main>

      <StorefrontFooter store={store} />
    </StorefrontShell>
  );
}

function PolicySection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-3 whitespace-pre-line text-sm leading-7 text-stone-700">
        {children}
      </p>
    </section>
  );
}
