import Image from "next/image";

type StorefrontLocation = {
  public_city: string | null;
  public_state: string | null;
};

type InventoryLabelSource = {
  inventory_type: string;
  custom_inventory_label: string | null;
};

export function StorefrontShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-stone-50 text-stone-950">{children}</div>;
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

function toPublicImageUrl(publicUrl: string) {
  if (publicUrl.startsWith("http")) return publicUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (publicUrl.startsWith("/") && supabaseUrl) {
    return `${supabaseUrl}${publicUrl}`;
  }

  return publicUrl;
}
