import {
  EmptyStorefront,
  InfoPanel,
  StorefrontCard,
  StorefrontFooter,
  StorefrontNav,
  StorefrontPage,
  StoreLogo,
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
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="This page could not load"
            description="Please refresh the page or return to the storefront."
          />
        </StorefrontPage>
      </StorefrontShell>
    );
  }

  if (!store) {
    return (
      <StorefrontShell>
        <StorefrontPage size="narrow" className="py-12">
          <EmptyStorefront
            title="Storefront not found"
            description="This storefront is not public right now."
          />
        </StorefrontPage>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <StorefrontNav store={store} />

      <StorefrontPage className="gap-7">
        <StorefrontCard className="bg-[#fffdf8] p-6">
          <div className="flex items-center gap-4">
            <StoreLogo store={store} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                Pickup and policies
              </p>
              <h1 className="mt-1 text-4xl font-semibold leading-tight text-stone-950">
                Buying from {store.store_name}
              </h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
            Review pickup details and seller policies before checkout. The
            seller will confirm final timing after your order is placed.
          </p>
        </StorefrontCard>

        <section className="grid gap-5 lg:grid-cols-[1fr_21rem]">
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
      </StorefrontPage>

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
    <StorefrontCard className="border-l-4 border-l-[#24512f]">
      <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-3 whitespace-pre-line text-sm leading-7 text-stone-700">
        {children}
      </p>
    </StorefrontCard>
  );
}
