import Image from "next/image";
import Link from "next/link";
import { PLAN_CAPABILITIES } from "@/lib/plan-capabilities";

const smallFlock = PLAN_CAPABILITIES.small_flock;
const fullFlock = PLAN_CAPABILITIES.full_flock;
const pricing = {
  fullMonthlyPrice: 29,
  fullYearlyPrice: 270,
  fullYearlySavings: 78,
  smallMonthlyPrice: 5,
  smallYearlyPrice: 50,
  smallYearlySavings: 10,
};

const comparisonRows = [
  {
    label: "List and sell live birds",
    small: "Up to 5",
    full: "Unlimited",
  },
  {
    label: "Preloaded breed library",
    small: "available",
    full: "available",
  },
  {
    label: "Quick storefront setup",
    small: "available",
    full: "available",
  },
  {
    label: "Create quick links for Facebook, email & more",
    small: "available",
    full: "available",
  },
  {
    label: "Built-in order management",
    small: "available",
    full: "available",
  },
  {
    label: "Inventory tracking",
    small: "available",
    full: "available",
  },
  {
    label: "Customer records & order history",
    small: "available",
    full: "available",
  },
  {
    label: "Sales reports & exports",
    small: "available",
    full: "available",
  },
  {
    label: "Automatic age adjusted pricing",
    small: "unavailable",
    full: "available",
  },
  {
    label: "Sell hatching eggs, poultry products, equipment & supplies",
    small: "unavailable",
    full: "available",
  },
] as const;

function BrandLogo({
  className = "",
}: Readonly<{
  className?: string;
}>) {
  return (
    <Image
      src="/landing-page/flockfront-logo-transparent.png"
      alt="FlockFront"
      width={2172}
      height={724}
      priority
      className={`h-auto object-contain ${className}`}
    />
  );
}

export function PricingPageClient() {
  return (
    <main className="min-h-screen bg-[#fffaf1] text-[#10281c]">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-2.5 md:px-8 md:py-2.5 lg:px-10">
        <header className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          <Link
            href="/"
            className="inline-flex w-fit rounded-md focus:outline-none focus:ring-2 focus:ring-[#0e4a2d] focus:ring-offset-4 focus:ring-offset-[#fffaf1]"
          >
            <BrandLogo className="w-[165px] md:w-[195px]" />
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-7 text-[15px] font-normal text-[#10281c] md:flex"
          >
            <Link className="transition hover:text-[#0e4a2d]" href="/#how-it-works">
              How it works
            </Link>
            <Link
              aria-current="page"
              className="font-semibold text-[#0e4a2d]"
              href="/pricing"
            >
              Pricing
            </Link>
            <Link className="transition hover:text-[#0e4a2d]" href="/login">
              Log In
            </Link>
          </nav>

          <div className="flex justify-start md:justify-end">
            <Link
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#b77918] bg-transparent px-4 text-[15px] font-semibold text-[#a86908] transition hover:bg-[#fff4df] focus:outline-none focus:ring-2 focus:ring-[#0e4a2d] focus:ring-offset-4 focus:ring-offset-[#fffaf1]"
              href="/signup"
            >
              Get Started
            </Link>
          </div>
        </header>

        <nav
          aria-label="Mobile primary navigation"
          className="mt-3 flex items-center justify-center gap-5 rounded-md border border-[#e8deca] bg-white/55 px-3 py-2 text-[15px] font-medium text-[#10281c] md:hidden"
        >
          <Link className="transition hover:text-[#0e4a2d]" href="/#how-it-works">
            How it works
          </Link>
          <Link
            aria-current="page"
            className="font-semibold text-[#0e4a2d]"
            href="/pricing"
          >
            Pricing
          </Link>
          <Link className="transition hover:text-[#0e4a2d]" href="/login">
            Log In
          </Link>
        </nav>

        <section className="mx-auto max-w-4xl px-2 pb-3 pt-4 text-center md:pb-3 md:pt-4">
          <h1 className="text-balance font-serif text-[clamp(2.05rem,3.5vw,3.35rem)] leading-[1.05] text-[#123d27]">
            Simple pricing for poultry sellers
          </h1>
          <p className="mx-auto mt-1.5 max-w-3xl text-balance text-[14px] leading-5 text-[#3f463f] md:text-[15px]">
            Start small with Small Flock, or choose the full toolkit for an
            active poultry business.
          </p>
        </section>

        <section
          aria-labelledby="pricing-comparison"
          className="mx-auto w-full max-w-[900px]"
        >
          <h2 id="pricing-comparison" className="sr-only">
            Plan comparison
          </h2>

          <div className="hidden overflow-hidden rounded-lg border border-[#e8deca] bg-white/54 lg:grid lg:grid-cols-[0.9fr_1fr_1.22fr]">
            <div className="border-r border-[#e8deca]" aria-hidden="true" />
            <PlanHeader
              buttonLabel="Choose Small Flock"
              description="For occasional sellers who only need to list a few birds at a time."
              monthlyPrice={pricing.smallMonthlyPrice}
              name={smallFlock.displayName}
              yearlyPrice={pricing.smallYearlyPrice}
              yearlySavings={pricing.smallYearlySavings}
            />
            <PlanHeader
              buttonLabel="Choose Full Flock"
              description="For active poultry sellers who need room to sell more birds and more types of poultry inventory."
              emphasized
              monthlyPrice={pricing.fullMonthlyPrice}
              name={fullFlock.displayName}
              yearlyPrice={pricing.fullYearlyPrice}
              yearlySavings={pricing.fullYearlySavings}
            />

            {comparisonRows.map((row) => (
              <DesktopComparisonRow key={row.label} row={row} />
            ))}
          </div>

          <div className="grid gap-3 lg:hidden">
            <PlanSummaryCard
              buttonLabel="Choose Small Flock"
              description="For occasional sellers who only need to list a few birds at a time."
              monthlyPrice={pricing.smallMonthlyPrice}
              name={smallFlock.displayName}
              yearlyPrice={pricing.smallYearlyPrice}
              yearlySavings={pricing.smallYearlySavings}
            />
            <PlanSummaryCard
              buttonLabel="Choose Full Flock"
              description="For active poultry sellers who need room to sell more birds and more types of poultry inventory."
              emphasized
              monthlyPrice={pricing.fullMonthlyPrice}
              name={fullFlock.displayName}
              yearlyPrice={pricing.fullYearlyPrice}
              yearlySavings={pricing.fullYearlySavings}
            />

            <div className="overflow-hidden rounded-lg border border-[#e8deca] bg-white/62 text-[#111827]">
              <div className="grid [grid-template-columns:minmax(0,1fr)_4.75rem_4.75rem] border-b border-[#e8deca] bg-[#fdf9ee]/60 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5f665f]">
                <div className="px-3 py-2">Feature</div>
                <div className="grid place-items-center border-l border-[#e8deca] px-1 py-2 text-center">
                  Small Flock
                </div>
                <div className="grid place-items-center border-l border-[#e8deca] px-1 py-2 text-center">
                  Full Flock
                </div>
              </div>
              {comparisonRows.map((row) => (
                <MobileComparisonRow key={row.label} row={row} />
              ))}
            </div>
          </div>

          <div className="mt-2 flex flex-col items-center gap-1.5 rounded-lg border border-[#e8deca] bg-white/58 px-4 py-2 text-center md:px-5">
            <Image
              src="/glyphs/hen.png"
              alt=""
              width={58}
              height={58}
              className="size-7 shrink-0 object-contain opacity-85"
            />
            <p className="max-w-2xl text-[13px] leading-5 text-[#1f2c24] md:text-[14px] md:leading-6">
              Both plans include the storefront, checkout, manual orders,
              customer records, pickup setup, seller policies, and core order
              emails.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function PlanHeader({
  buttonLabel,
  description,
  emphasized = false,
  monthlyPrice,
  name,
  yearlyPrice,
  yearlySavings,
}: {
  buttonLabel: string;
  description: string;
  emphasized?: boolean;
  monthlyPrice: number;
  name: string;
  yearlyPrice: number;
  yearlySavings: number;
}) {
  return (
    <div
      className={`flex min-h-[160px] flex-col items-center justify-start border-b border-[#e8deca] px-6 py-3 text-center ${
        emphasized
          ? "border-x border-t border-[#123d27] bg-[#fdf9ee]/60"
          : "border-r border-[#e8deca]"
      }`}
    >
      {emphasized ? (
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#a86908]">
          Best value
        </p>
      ) : null}
      <h3 className="font-serif text-[1.45rem] font-semibold leading-tight text-[#123d27]">
        {name}
      </h3>
      <p className="mt-2 font-serif text-[2.15rem] font-normal leading-none text-[#123d27]">
        <span>${monthlyPrice}</span>
        <span className="ml-1 text-[14px] font-normal text-[#10281c]">
          /month
        </span>
      </p>
      <p className="mt-1 text-[13px] font-medium text-[#10281c]">
        or ${yearlyPrice}/year
      </p>
      <p className="mt-0.5 min-h-4 text-[12px] font-medium text-[#a86908]">
        Save ${yearlySavings} yearly
      </p>
      <p className="mt-2 max-w-sm text-[13px] leading-5 text-[#111827]">
        {description}
      </p>
      <form action="/signup" className="mt-auto w-full max-w-[230px]">
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-md bg-[#0f4329] px-4 text-[14px] font-semibold text-white transition hover:bg-[#0a3220] focus:outline-none focus:ring-2 focus:ring-[#0f4329] focus:ring-offset-4 focus:ring-offset-[#fffaf1]"
          type="submit"
        >
          {buttonLabel}
        </button>
      </form>
    </div>
  );
}

function PlanSummaryCard({
  buttonLabel,
  description,
  emphasized = false,
  monthlyPrice,
  name,
  yearlyPrice,
  yearlySavings,
}: {
  buttonLabel: string;
  description: string;
  emphasized?: boolean;
  monthlyPrice: number;
  name: string;
  yearlyPrice: number;
  yearlySavings: number;
}) {
  return (
    <article
      className={`rounded-lg border bg-white/62 px-4 py-4 text-center sm:px-5 sm:py-6 ${
        emphasized ? "border-[#123d27] bg-[#fdf9ee]/72" : "border-[#e8deca]"
      }`}
    >
      {emphasized ? (
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[#a86908] sm:text-sm">
          Best value
        </p>
      ) : null}
      <h3 className="font-serif text-[1.85rem] font-semibold leading-tight text-[#123d27] sm:text-[2.15rem]">
        {name}
      </h3>
      <p className="mt-4 font-serif text-[2.45rem] leading-none text-[#123d27] sm:mt-5 sm:text-[3rem]">
        <span>${monthlyPrice}</span>
        <span className="ml-1 text-[14px] font-normal text-[#10281c]">
          /month
        </span>
      </p>
      <p className="mt-2 text-sm font-medium text-[#10281c] sm:text-base">
        or ${yearlyPrice}/year
      </p>
      <p className="mt-1 min-h-5 text-sm font-medium text-[#a86908] sm:text-base">
        Save ${yearlySavings} yearly
      </p>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-6 text-[#111827] sm:mt-4 sm:text-base sm:leading-7">
        {description}
      </p>
      <form action="/signup" className="mt-4 sm:mt-6">
        <button
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#0f4329] px-5 text-base font-semibold text-white transition hover:bg-[#0a3220] focus:outline-none focus:ring-2 focus:ring-[#0f4329] focus:ring-offset-4 focus:ring-offset-[#fffaf1] sm:min-h-12"
          type="submit"
        >
          {buttonLabel}
        </button>
      </form>
    </article>
  );
}

function DesktopComparisonRow({
  row,
}: {
  row: (typeof comparisonRows)[number];
}) {
  return (
    <>
      <div className="border-r border-t border-[#e8deca] px-4 py-2 text-[13px] font-bold leading-5 text-[#111827]">
        {row.label}
      </div>
      <div className="grid place-items-center border-r border-t border-[#e8deca] px-4 py-2 text-center text-[14px] text-[#111827]">
        <PlanValue value={row.small} />
      </div>
      <div className="grid place-items-center border-x border-t border-[#e8deca] border-x-[#123d27] px-4 py-2 text-center text-[14px] text-[#111827]">
        <PlanValue value={row.full} />
      </div>
    </>
  );
}

function MobileComparisonRow({
  row,
}: {
  row: (typeof comparisonRows)[number];
}) {
  return (
    <div className="grid min-h-12 [grid-template-columns:minmax(0,1fr)_4.75rem_4.75rem] border-t border-[#e8deca] first:border-t-0">
      <div className="min-w-0 px-3 py-2.5 text-[13px] font-bold leading-5 text-[#111827]">
        {row.label}
      </div>
      <div className="grid place-items-center border-l border-[#e8deca] px-1 py-2 text-center text-[13px] text-[#111827]">
        <PlanValue mobile value={row.small} />
      </div>
      <div className="grid place-items-center border-l border-[#e8deca] px-1 py-2 text-center text-[13px] text-[#111827]">
        <PlanValue mobile value={row.full} />
      </div>
    </div>
  );
}

function PlanValue({
  mobile = false,
  value,
}: {
  mobile?: boolean;
  value: "Up to 5" | "Unlimited" | "available" | "unavailable";
}) {
  if (value === "available") {
    return (
      <span
        aria-label="Available"
        className={`font-semibold leading-none text-[#123d27] ${
          mobile ? "text-[1.3rem]" : "text-[1.15rem]"
        }`}
        role="img"
      >
        &#10003;
      </span>
    );
  }

  if (value === "unavailable") {
    return (
      <span
        aria-label="Unavailable"
        className={`leading-none text-[#b77918] ${
          mobile ? "text-[1.55rem] font-medium" : "text-[1.15rem] font-normal"
        }`}
        role="img"
      >
        &#215;
      </span>
    );
  }

  return <span>{value}</span>;
}
