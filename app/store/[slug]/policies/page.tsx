import Link from "next/link";
import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import {
  EmptyStorefront,
  StorefrontPage,
  StorefrontShell,
  cx,
  formatLocation,
  toPublicImageUrl,
} from "../storefront-ui";
import { loadStorefrontChrome } from "../storefront-chrome-data";
import { storefrontSerifClass } from "../storefront-fonts";
import { StorefrontChrome } from "../storefront-shell-components";
import {
  loadStorefrontAccess,
  type StorefrontHome,
} from "../storefront-data";
import { buildStorefrontPolicySections } from "../storefront-policies";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";
import {
  buildPublicMetadata,
  withFlockFrontBrand,
} from "@/lib/public-metadata";
import {
  resolveStorefrontVisibilityDecision,
  shouldNoIndexStorefrontRoute,
} from "@/lib/storefront-visibility";

const loadStorefrontChromeCached = cache(loadStorefrontChrome);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [{ error, store }, accessResult] = await Promise.all([
    loadStorefrontChromeCached(slug),
    loadStorefrontAccess(slug),
  ]);
  const canonicalPath = `/store/${encodeURIComponent(slug)}/policies`;

  if (error || accessResult.error || !store || !accessResult.data) {
    return {
      ...buildPublicMetadata({
        canonicalPath,
        title: "Storefront Not Found | FlockFront",
        description: "This storefront is not publicly available on FlockFront.",
      }),
      robots: NOINDEX_ROBOTS,
    };
  }

  if (
    shouldNoIndexStorefrontRoute({
      searchParams: {},
      storeSlug: slug,
      visibility: accessResult.data.storefront_visibility,
      websiteUrl: accessResult.data.website_url,
    })
  ) {
    return { robots: NOINDEX_ROBOTS };
  }

  const imageUrl = store.hero_image_url
    ? toPublicImageUrl(store.hero_image_url)
    : null;

  return buildPublicMetadata({
    canonicalPath,
    title: withFlockFrontBrand(`${store.store_name} Policies`),
    description: `Review the seller-provided policies for ${store.store_name} on FlockFront.`,
    image: imageUrl
      ? {
          alt: store.hero_image_alt_text || undefined,
          url: imageUrl,
        }
      : null,
  });
}

export default async function StorefrontPoliciesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [{ categories, error, store }, accessResult] = await Promise.all([
    loadStorefrontChromeCached(slug),
    loadStorefrontAccess(slug),
  ]);

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

  if (accessResult.error || !accessResult.data) notFound();
  const visibilityDecision = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: accessResult.data.is_publicly_available,
    searchParams: {},
    storeSlug: store.store_slug,
    visibility: accessResult.data.storefront_visibility,
    websiteUrl: accessResult.data.website_url,
  });
  if (visibilityDecision.action === "redirect") redirect(visibilityDecision.url);
  if (visibilityDecision.action === "deny") notFound();

  const policySections = buildStorefrontPolicySections({
    cancellationPolicy: store.cancellation_policy,
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
                    {formatPublicPhoneContact(store)}
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

function formatPublicPhoneContact(store: StorefrontHome) {
  if (!store.public_phone) return "";
  if (store.buyer_contact_text_enabled && !store.buyer_contact_phone_enabled) {
    return `${store.public_phone} (Text Only)`;
  }
  if (store.buyer_contact_text_enabled && store.buyer_contact_phone_enabled) {
    return `${store.public_phone} (Call or Text)`;
  }
  return store.public_phone;
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
