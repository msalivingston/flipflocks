import Link from "next/link";

type SellerPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function SellerPageHeader({
  eyebrow,
  title,
  description,
  action,
}: SellerPageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-stone-200 bg-white px-5 py-5 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold text-stone-950">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SellerCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-transparent bg-white shadow-none sm:border-stone-200 sm:shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

export function DashboardPageContent({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-full min-w-0 max-w-none px-5 py-5 sm:px-7 ${className}`}>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = status ? status.replaceAll("_", " ") : "unknown";
  const tone = getStatusTone(status);

  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full px-2.5 py-1 text-sm font-semibold capitalize sm:min-h-0 sm:text-xs ${tone}`}
    >
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: SellerPageHeaderProps) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center">
      <h2 className="text-base font-semibold text-stone-950">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-lg border border-stone-200 bg-white px-5 py-8 text-sm font-medium text-stone-600">
      {label}
    </div>
  );
}

export function ErrorState({
  title = "Something needs attention",
  message,
  action,
}: {
  title?: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-5">
      <h2 className="text-base font-semibold text-red-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-red-800">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ContactActionButtons({
  phone,
  email,
  label = "customer",
}: {
  phone?: string | null;
  email?: string | null;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {phone ? (
        <>
          <a className="seller-small-button" href={`tel:${phone}`}>
            Call {label}
          </a>
          <a className="seller-small-button" href={`sms:${phone}`}>
            Text {label}
          </a>
        </>
      ) : null}
      {email ? (
        <a className="seller-small-button" href={`mailto:${email}`}>
          Email {label}
        </a>
      ) : null}
    </div>
  );
}

export function ActionMenu({
  label = "More",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="relative">
      <summary className="seller-small-button cursor-pointer list-none">
        {label}
      </summary>
      <div className="absolute right-0 z-20 mt-2 min-w-44 rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
        {children}
      </div>
    </details>
  );
}

export function PrimaryActionLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800"
    >
      {children}
    </Link>
  );
}

export function SellerTabs<TValue extends string>({
  value,
  tabs,
  onChange,
}: {
  value: TValue;
  tabs: { label: string; value: TValue }[];
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
      {tabs.map((tab) => {
        const isActive = value === tab.value;

        return (
          <button
            key={tab.value}
            type="button"
            className={`min-h-9 rounded-md px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
              isActive
                ? "bg-emerald-800 text-white"
                : "text-stone-700 hover:bg-stone-100"
            }`}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-base font-bold text-stone-700 sm:text-sm">
      {label}
      <select
        className="min-h-12 rounded-md border border-stone-300 bg-white px-3 text-base font-semibold text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 sm:min-h-10 sm:text-sm sm:font-medium"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function getStatusTone(status: string | null | undefined) {
  if (!status) return "bg-stone-100 text-stone-700";

  if (["active", "ready_now", "fulfilled", "paid", "live"].includes(status)) {
    return "bg-emerald-100 text-emerald-800";
  }

  if (["pending", "open", "reserve_now"].includes(status)) {
    return "bg-amber-100 text-amber-800";
  }

  if (["hidden", "draft", "sold_out"].includes(status)) {
    return "bg-sky-100 text-sky-800";
  }

  if (["canceled", "failed", "unavailable", "archived"].includes(status)) {
    return "bg-red-100 text-red-800";
  }

  return "bg-stone-100 text-stone-700";
}
