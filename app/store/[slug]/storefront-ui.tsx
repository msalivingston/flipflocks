import Image from "next/image";
import Link from "next/link";

type StorefrontLocation = {
  public_city: string | null;
  public_state: string | null;
};

type StorefrontIdentity = StorefrontLocation & {
  store_name: string;
  store_slug: string;
  logo_image_url: string | null;
  logo_image_alt_text: string | null;
};

type InventoryLabelSource = {
  inventory_type: string;
  custom_inventory_label: string | null;
};

export function StorefrontShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f5ef] text-stone-950">{children}</div>
  );
}

export function StorefrontNav({ store }: { store: StorefrontIdentity }) {
  return (
    <nav className="border-b border-stone-200 bg-white/95">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-4 sm:px-7 md:flex-row md:items-center md:justify-between">
        <Link
          className="flex min-w-0 items-center gap-3 text-stone-950"
          href={`/store/${store.store_slug}`}
        >
          <StoreLogo store={store} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{store.store_name}</p>
            <p className="text-xs font-medium text-stone-500">
              {formatLocation(store)}
            </p>
          </div>
        </Link>
        <div className="flex flex-wrap gap-2 text-sm font-semibold text-stone-700">
          <Link
            className="rounded-md px-2 py-1 hover:bg-stone-100"
            href={`/store/${store.store_slug}`}
          >
            Shop
          </Link>
          <Link
            className="rounded-md px-2 py-1 hover:bg-stone-100"
            href={`/store/${store.store_slug}/about`}
          >
            About
          </Link>
          <Link
            className="rounded-md px-2 py-1 hover:bg-stone-100"
            href={`/store/${store.store_slug}/policies`}
          >
            Pickup & policies
          </Link>
          <Link
            className="rounded-md px-2 py-1 hover:bg-stone-100"
            href={`/store/${store.store_slug}/cart`}
          >
            Cart
          </Link>
        </div>
      </div>
    </nav>
  );
}

export function StorefrontFooter({ store }: { store: StorefrontIdentity }) {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-6 text-sm text-stone-600 sm:px-7 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <StoreLogo store={store} size="xs" />
          <div>
            <p className="font-semibold text-stone-950">{store.store_name}</p>
            <p>{formatLocation(store)}</p>
          </div>
        </div>
        <p>Powered by the FlipFlocks storefront platform.</p>
      </div>
    </footer>
  );
}

export function StoreLogo({
  size = "md",
  store,
}: {
  size?: "xs" | "sm" | "md";
  store: Pick<
    StorefrontIdentity,
    "logo_image_alt_text" | "logo_image_url" | "store_name"
  >;
}) {
  const sizeClass =
    size === "xs" ? "h-9 w-9" : size === "sm" ? "h-12 w-12" : "h-16 w-16";

  if (!store.logo_image_url) {
    return (
      <div
        className={`${sizeClass} flex shrink-0 items-center justify-center rounded-md border border-emerald-100 bg-emerald-50 text-base font-bold text-emerald-900`}
      >
        {store.store_name.trim().slice(0, 1).toUpperCase() || "S"}
      </div>
    );
  }

  return (
    <Image
      alt={store.logo_image_alt_text || `${store.store_name} logo`}
      className={`${sizeClass} shrink-0 rounded-md object-cover`}
      height={96}
      src={toPublicImageUrl(store.logo_image_url)}
      unoptimized
      width={96}
    />
  );
}

export function HeroImage({
  alt,
  src,
}: {
  alt: string;
  src: string | null;
}) {
  if (!src) {
    return (
      <div className="flex min-h-64 items-center justify-center bg-[linear-gradient(135deg,#064e3b,#ca8a04)] px-5 text-center text-white sm:min-h-80">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-white/80">
            Seller storefront
          </p>
          <p className="mt-3 max-w-lg text-3xl font-semibold">
            Fresh availability from a local farm.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      className="h-full min-h-64 w-full object-cover sm:min-h-80"
      height={720}
      priority
      src={toPublicImageUrl(src)}
      unoptimized
      width={1280}
    />
  );
}

export function ListingPhoto({
  alt,
  src,
}: {
  alt: string;
  src: string | null;
}) {
  if (!src) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-emerald-50 px-4 text-center text-sm font-semibold text-emerald-900">
        Photo coming soon
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      className="aspect-[4/3] w-full object-cover"
      height={600}
      src={toPublicImageUrl(src)}
      unoptimized
      width={800}
    />
  );
}

export function InfoPanel({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-stone-950">{title}</h2>
      <div className="mt-2 grid gap-2 text-sm leading-6 text-stone-600">
        {children}
      </div>
    </section>
  );
}

export function StoreMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white px-2 py-2">
      <div className="text-base text-stone-950">{value}</div>
      <div>{label}</div>
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

export function AvailabilityBadge({
  code,
  label,
}: {
  code: string;
  label: string;
}) {
  const tone =
    code === "ready_now"
      ? "bg-emerald-100 text-emerald-800"
      : code === "reserve_now"
        ? "bg-amber-100 text-amber-800"
        : "bg-stone-100 text-stone-700";

  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

export function EmptyStorefront({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-5 py-8 text-center">
      <h1 className="text-xl font-semibold text-stone-950">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
        {description}
      </p>
    </div>
  );
}

export function formatInventoryLabel(item: InventoryLabelSource) {
  return item.custom_inventory_label || item.inventory_type.replaceAll("_", " ");
}

export function formatLocation(item: StorefrontLocation) {
  const location = [item.public_city, item.public_state].filter(Boolean).join(", ");

  return location || "Pickup area coming soon";
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function toPublicImageUrl(publicUrl: string) {
  if (publicUrl.startsWith("http")) return publicUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (publicUrl.startsWith("/") && supabaseUrl) {
    return `${supabaseUrl}${publicUrl}`;
  }

  return publicUrl;
}
