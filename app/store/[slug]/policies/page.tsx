import Link from "next/link";
import {
  EmptyStorefront,
  StorefrontPage,
  StorefrontShell,
  cx,
  formatLocation,
} from "../storefront-ui";
import { loadStorefrontChrome } from "../storefront-chrome-data";
import { storefrontSerifClass } from "../storefront-fonts";
import { StorefrontChrome } from "../storefront-shell-components";
import type { StorefrontCustomPolicy } from "../storefront-data";

export default async function StorefrontPoliciesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { categories, error, store } = await loadStorefrontChrome(slug);

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

  const policySections = buildPolicySections({
    customPolicies: store.custom_policies,
    otherPolicies: store.other_policies,
    pickupPolicy: store.pickup_policy,
  });
  const hasContact = Boolean(store.public_email || store.public_phone);
  const location = formatLocation(store);

  return (
    <StorefrontChrome categories={categories} store={store}>
      <StorefrontPage className="max-w-[70rem] gap-4 py-5 lg:gap-5 lg:py-6">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-2 text-xs font-medium text-stone-600"
        >
          <Link
            className="hover:text-[var(--storefront-heading-color)]"
            href={`/store/${store.store_slug}`}
          >
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            className="hover:text-[var(--storefront-heading-color)]"
            href={`/store/${store.store_slug}#shop-listings`}
          >
            Shop
          </Link>
          <span aria-hidden="true">/</span>
          <span className="storefront-primary-color text-[#073f1e]">
            Pickup & Policies
          </span>
        </nav>

        <header className="max-w-2xl">
          <h1 className="storefront-heading-color text-xs font-bold uppercase tracking-[0.2em]">
            Pickup & Policies
          </h1>
          <div className="mt-3 h-px w-14 bg-[#cbbd96]" />
          {policySections.length > 0 ? (
          <div className="mt-3 grid gap-1.5 text-sm leading-6 text-stone-700">
              <p>Please review pickup details and policies before placing your order.</p>
              <p>The seller will confirm final timing after your order is placed.</p>
            </div>
          ) : null}
        </header>

        {policySections.length > 0 ? (
          <section className="grid gap-3">
            {policySections.map((section) => (
              <PolicyCard body={section.body} key={section.title} title={section.title} />
            ))}
          </section>
        ) : (
          <EmptyStorefront
            title="No pickup policies posted yet"
            description="The seller will confirm pickup details after your order is placed."
          />
        )}

        <section className="grid overflow-hidden rounded-lg border border-[#d8cbb5] bg-[#fffaf0] sm:grid-cols-2">
          {location ? (
            <InfoCard title="Pickup region">
              <p>{location}</p>
            </InfoCard>
          ) : null}
          {hasContact ? (
            <InfoCard className="border-t border-[#ded7c8] sm:border-l sm:border-t-0" title="Contact">
              {store.public_email ? (
                <p>
                  Email:{" "}
                  <a
                    className="storefront-primary-color font-medium text-[#073f1e]"
                    href={`mailto:${store.public_email}`}
                  >
                    {store.public_email}
                  </a>
                </p>
              ) : null}
              {store.public_phone ? (
                <p>
                  Phone:{" "}
                  <a
                    className="storefront-primary-color font-medium text-[#073f1e]"
                    href={`tel:${store.public_phone}`}
                  >
                    {store.public_phone}
                  </a>
                </p>
              ) : null}
            </InfoCard>
          ) : null}
        </section>
      </StorefrontPage>
    </StorefrontChrome>
  );
}

function PolicyCard({ body, title }: { body: string; title: string }) {
  return (
    <section className="rounded-lg border border-[#d8cbb5] bg-[#fffaf0] px-4 py-4 sm:px-6 sm:py-5">
      <h2
        className={cx(
          storefrontSerifClass,
          "storefront-heading-color text-xl font-normal leading-tight text-stone-950 sm:text-2xl",
        )}
      >
        {title}
      </h2>
      <div className="storefront-text-color mt-3 grid gap-2 whitespace-pre-line text-sm leading-6 text-stone-700">
        {body}
      </div>
    </section>
  );
}

function InfoCard({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={cx("px-4 py-4 sm:px-6", className)}>
      <h2
        className={cx(
          storefrontSerifClass,
          "storefront-heading-color text-lg font-normal leading-tight text-stone-950",
        )}
      >
        {title}
      </h2>
      <div className="mt-2.5 h-px w-9 bg-[#cbbd96]" />
      <div className="storefront-text-color mt-3 grid gap-1.5 text-sm leading-6 text-stone-700">
        {children}
      </div>
    </section>
  );
}

function buildPolicySections({
  customPolicies,
  otherPolicies,
  pickupPolicy,
}: {
  customPolicies?: StorefrontCustomPolicy[] | null;
  otherPolicies?: string | null;
  pickupPolicy: string | null;
}) {
  const sections: Array<{ body: string; title: string }> = [];

  addSection(sections, "Pickup policy", pickupPolicy);
  addSection(sections, "Other policies", otherPolicies);

  for (const policy of normalizeCustomPolicies(customPolicies)) {
    addSection(sections, policy.title, policy.body);
  }

  return sections;
}

function addSection(
  sections: Array<{ body: string; title: string }>,
  title: string,
  body: string | null | undefined,
) {
  const trimmed = body?.trim();

  if (!trimmed) return;

  sections.push({ body: trimmed, title });
}

function normalizeCustomPolicies(
  policies: StorefrontCustomPolicy[] | null | undefined,
) {
  if (!Array.isArray(policies)) return [];

  return policies
    .map((policy) => ({
      body: policy.body?.trim() ?? "",
      title: policy.title?.trim() ?? "",
    }))
    .filter((policy) => policy.title && policy.body)
    .slice(0, 4);
}
