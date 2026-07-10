import Image from "next/image";
import Link from "next/link";
import { storefrontSans, storefrontSerifClass } from "./storefront-fonts";

type StorefrontLocation = {
  public_city: string | null;
  public_state: string | null;
};

type StorefrontIdentity = StorefrontLocation & {
  store_name: string;
  store_slug: string;
  logo_image_url: string | null;
  logo_image_alt_text: string | null;
  public_email?: string | null;
  public_phone?: string | null;
  website_url?: string | null;
};

type InventoryLabelSource = {
  inventory_type: string;
  custom_inventory_label: string | null;
};

export const storefrontTheme = {
  background: "bg-white",
  border: "border-[#ded7c8]",
  focus: "focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2",
  mutedText: "text-stone-600",
  primary: "bg-[#24512f] text-white hover:bg-[#183b22]",
  primaryText: "text-stone-950",
  secondarySurface: "bg-[#fbf7ef]",
  surface: "bg-white",
  successSurface: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warningSurface: "border-amber-200 bg-amber-50 text-amber-950",
  errorSurface: "border-rose-200 bg-rose-50 text-rose-800",
};

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const storefrontHeroTypography = {
  eyebrow: "text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800",
  title:
    `${storefrontSerifClass} mt-2 text-3xl font-bold leading-[1.05] text-stone-950 sm:text-[2.75rem] lg:text-5xl`,
  body: "mt-3 max-w-[30rem] text-sm leading-6 text-stone-700 sm:text-base",
};

export const storefrontHeroFrame = {
  aspectClass: "aspect-[10/3]",
  aspectRatio: 10 / 3,
  publicClass:
    "relative h-[clamp(20rem,64vw,24rem)] overflow-hidden bg-white sm:h-[clamp(18.5rem,40vw,23rem)] lg:h-[clamp(18.75rem,33vw,23.25rem)]",
  setupPreviewScale: 0.72,
  setupPreviewClass:
    "relative mx-auto aspect-[10/3] w-full max-w-[50rem] overflow-hidden border border-stone-200 bg-stone-100",
};

export function storefrontButtonClass({
  className,
  variant = "primary",
}: {
  className?: string;
  variant?: "primary" | "secondary";
} = {}) {
  return cx(
    "inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-white lg:min-h-11 lg:px-5 lg:text-base",
    storefrontTheme.focus,
    variant === "primary"
      ? storefrontTheme.primary
      : "border border-[#cfc7b8] bg-white text-stone-800 hover:bg-[#fbf7ef]",
    className,
  );
}

export function StorefrontShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cx(
        storefrontSans.className,
        "buyer-storefront",
        "min-h-screen text-stone-950 antialiased",
        storefrontTheme.background,
      )}
    >
      {children}
    </div>
  );
}

export function StorefrontPage({
  children,
  className,
  size = "default",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "default" | "narrow";
}) {
  return (
    <main
      className={cx(
        "mx-auto grid gap-8 px-5 py-8 sm:px-7",
        size === "narrow" ? "max-w-3xl" : "max-w-6xl",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function StorefrontContainer({
  children,
  className,
  size = "default",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "default" | "narrow";
}) {
  return (
    <div
      className={cx(
        "mx-auto px-5 sm:px-7",
        size === "narrow" ? "max-w-3xl" : "max-w-6xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StorefrontSection({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={cx("grid gap-4", className)} id={id}>
      {children}
    </section>
  );
}

export function StorefrontEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className={storefrontHeroTypography.eyebrow}>
      {children}
    </p>
  );
}

export function StorefrontSectionHeader({
  children,
  eyebrow,
  title,
}: {
  children?: React.ReactNode;
  eyebrow?: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? <StorefrontEyebrow>{eyebrow}</StorefrontEyebrow> : null}
        <h2 className="mt-1 text-2xl font-semibold text-stone-950">{title}</h2>
      </div>
      {children ? (
        <div className="max-w-xl text-sm leading-6 text-stone-600">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function StorefrontCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-lg border border-[#ded7c8] bg-white p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function StorefrontSummaryCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cx(
        "rounded-lg border border-[#ded7c8] bg-white p-5",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function StorefrontButton({
  children,
  className,
  disabled,
  href,
  onClick,
  type = "button",
  variant = "primary",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  href?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
  variant?: "primary" | "secondary";
}) {
  const buttonClass = storefrontButtonClass({ className, variant });

  if (href) {
    return (
      <Link className={buttonClass} href={href}>
        {children}
      </Link>
    );
  }

  return (
    <button
      className={buttonClass}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function StorefrontTextButton({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      className={cx(
        "text-sm font-semibold text-stone-500 hover:text-rose-700",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function StorefrontLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("grid gap-1 text-sm font-semibold text-stone-800", className)}>
      {children}
    </label>
  );
}

export const storefrontInputClass = cx(
  "min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-base font-normal text-stone-950",
  "focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200",
  "disabled:bg-stone-100 disabled:text-stone-400",
);

export function StorefrontInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return <input {...props} className={cx(storefrontInputClass, props.className)} />;
}

export function StorefrontTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={cx(
        "min-h-24 rounded-md border border-stone-300 bg-white px-3 py-2 text-base font-normal text-stone-950 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200",
        props.className,
      )}
    />
  );
}

export function StorefrontNav({ store }: { store: StorefrontIdentity }) {
  return (
    <nav className="sticky top-0 z-20 border-b border-[#e5decf] bg-white/95 backdrop-blur">
      <StorefrontContainer className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Link
          className={cx(
            "flex min-w-0 items-center gap-3 rounded-md text-stone-950",
            storefrontTheme.focus,
          )}
          href={`/store/${store.store_slug}`}
        >
          <StoreLogo store={store} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold leading-tight text-[#23412a]">
              {store.store_name}
            </p>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-stone-500">
              {formatLocation(store)}
            </p>
          </div>
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-700">
          <Link
            className="rounded-md px-3 py-2 hover:bg-[#f6f1e8] hover:text-[#24512f]"
            href={`/store/${store.store_slug}`}
          >
            Shop
          </Link>
          <Link
            className="rounded-md px-3 py-2 hover:bg-[#f6f1e8] hover:text-[#24512f]"
            href={`/store/${store.store_slug}/about`}
          >
            About
          </Link>
          <Link
            className="rounded-md px-3 py-2 hover:bg-[#f6f1e8] hover:text-[#24512f]"
            href={`/store/${store.store_slug}/policies`}
          >
            Pickup & policies
          </Link>
          <Link
            className="inline-flex min-h-10 items-center rounded-md border border-[#24512f] bg-[#24512f] px-4 text-white hover:bg-[#183b22]"
            href={`/store/${store.store_slug}/cart`}
          >
            Cart
          </Link>
        </div>
      </StorefrontContainer>
    </nav>
  );
}

export function StorefrontFooter({ store }: { store: StorefrontIdentity }) {
  const contactItems = [
    store.public_email ? { label: "Email", value: store.public_email } : null,
    store.public_phone ? { label: "Phone", value: store.public_phone } : null,
    store.website_url ? { label: "Website", value: store.website_url } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <footer className="border-t border-[#e4dccc] bg-[#fffdf8]">
      <StorefrontContainer className="grid gap-8 py-10 text-sm text-stone-600 md:grid-cols-2 lg:grid-cols-[1.25fr_0.9fr_0.75fr_0.75fr]">
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <StoreLogo store={store} size="sm" />
            <div>
              <p className="text-lg font-semibold leading-tight text-[#23412a]">
                {store.store_name}
              </p>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-stone-500">
                {formatLocation(store)}
              </p>
            </div>
          </div>
          <p className="max-w-xs leading-6">
            Fresh availability from this seller storefront.
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
            Powered by FlipFlocks
          </p>
        </div>
        <div>
          <p className="font-semibold text-stone-950">Contact</p>
          <div className="mt-3 grid gap-2">
            {contactItems.length > 0 ? (
              contactItems.map((item) => (
                <p key={item.label}>
                  <span className="font-semibold text-stone-800">
                    {item.label}:
                  </span>{" "}
                  {item.value}
                </p>
              ))
            ) : (
              <p>The seller will follow up after your order is placed.</p>
            )}
          </div>
        </div>
        <div>
          <p className="font-semibold text-stone-950">Shop</p>
          <div className="mt-3 grid gap-2">
            <Link href={`/store/${store.store_slug}`}>Live Poultry</Link>
            <Link href={`/store/${store.store_slug}/cart`}>Cart</Link>
            <Link href={`/store/${store.store_slug}/checkout`}>Checkout</Link>
          </div>
        </div>
        <div>
          <p className="font-semibold text-stone-950">Quick Links</p>
          <div className="mt-3 grid gap-2">
            <Link href={`/store/${store.store_slug}/about`}>
              About Our Farm
            </Link>
            <Link href={`/store/${store.store_slug}/policies`}>
              Pickup Location
            </Link>
          </div>
        </div>
      </StorefrontContainer>
    </footer>
  );
}

export function StoreLogo({
  size = "md",
  store,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  store: Pick<
    StorefrontIdentity,
    "logo_image_alt_text" | "logo_image_url" | "store_name"
  >;
}) {
  const sizeClass =
    size === "xs"
      ? "h-9 w-9"
      : size === "sm"
        ? "h-12 w-12"
        : size === "lg"
          ? "h-20 w-20 lg:h-[5.5rem] lg:w-[5.5rem]"
          : "h-16 w-16";

  if (!store.logo_image_url) {
    return (
      <div
        className={`${sizeClass} flex shrink-0 items-center justify-center rounded-md border border-emerald-100 bg-[#eef4e8] text-base font-bold text-[#24512f]`}
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
      <div className="relative h-full min-h-80 overflow-hidden bg-[linear-gradient(135deg,#f6ead8_0%,#d9e6cf_45%,#8fae72_100%)] sm:min-h-[28rem]">
        <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent,#5e7d3d)] opacity-45" />
        <div className="absolute bottom-0 left-[12%] h-24 w-44 rounded-t-lg bg-[#8d3f20] shadow-[22px_-42px_0_-18px_#7d341c,140px_-34px_0_-14px_#f4dfbf]" />
        <div className="absolute bottom-0 right-[8%] h-32 w-20 rounded-t-full bg-[#d8c9aa] shadow-[-34px_4px_0_-8px_#c6b796]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,rgba(255,255,255,0.7),transparent_26%),linear-gradient(90deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.22)_38%,rgba(255,255,255,0)_66%)]" />
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      className="h-full min-h-80 w-full object-cover sm:min-h-[28rem]"
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
  aspect = "default",
  src,
}: {
  alt: string;
  aspect?: "default" | "square";
  src: string | null;
}) {
  if (!src) {
    return (
      <StorefrontPlaceholderImage aspect={aspect} label="Photo coming soon" />
    );
  }

  return (
    <Image
      alt={alt}
      className={`${aspect === "square" ? "aspect-square" : "aspect-[4/3]"} w-full object-cover`}
      height={600}
      src={toPublicImageUrl(src)}
      unoptimized
      width={800}
    />
  );
}

export function StorefrontMediaFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("overflow-hidden rounded-md bg-stone-100", className)}>
      {children}
    </div>
  );
}

export function StorefrontPlaceholderImage({
  aspect = "default",
  label = "Photo coming soon",
}: {
  aspect?: "default" | "square";
  label?: string;
}) {
  return (
    <div className={`flex ${aspect === "square" ? "aspect-square" : "aspect-[4/3]"} items-center justify-center bg-[#f4f1ea] px-4 text-center text-sm font-semibold text-stone-500`}>
      <span className="rounded-md border border-[#e1d8c8] bg-white/65 px-3 py-1">
        {label}
      </span>
    </div>
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
    <StorefrontCard className="p-4">
      <h2 className="font-semibold text-stone-950">{title}</h2>
      <div className="mt-2 grid gap-2 text-sm leading-6 text-stone-600">
        {children}
      </div>
    </StorefrontCard>
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
      ? "border-emerald-200 bg-white/90 text-emerald-800"
      : code === "reserve_now"
        ? "border-amber-200 bg-white/90 text-amber-800"
        : "border-stone-200 bg-white/90 text-stone-700";

  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm backdrop-blur lg:px-3 lg:py-1.5 ${tone}`}
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
    <StorefrontEmptyState title={title} description={description} />
  );
}

export function StorefrontEmptyState({
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

  if (publicUrl.startsWith("/storage/") && supabaseUrl) {
    return `${supabaseUrl}${publicUrl}`;
  }

  return publicUrl;
}
