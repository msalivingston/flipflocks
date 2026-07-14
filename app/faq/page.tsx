import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { publicSupabase } from "@/lib/public-supabase";
import { FaqAccordion, type PublicFaq } from "./faq-accordion";

export const metadata: Metadata = {
  title: "FAQ | FlockFront",
  description:
    "Frequently asked questions about FlockFront for poultry sellers.",
};

const previewStoreHref = "/store/willow-creek-poultry";

type SiteFaqRow = {
  answer: string;
  id: string;
  question: string;
};

async function loadPublishedFaqs() {
  const { data, error } = await publicSupabase
    .from("site_faqs")
    .select("id, question, answer")
    .eq("is_published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Public FAQ query failed", error);
    return { faqs: [] as PublicFaq[], hasError: true };
  }

  return {
    faqs: ((data ?? []) as SiteFaqRow[]).map((faq) => ({
      answer: faq.answer,
      id: faq.id,
      question: faq.question,
    })),
    hasError: false,
  };
}

function BrandLogo({
  className = "",
  mobileClassName,
}: Readonly<{
  className?: string;
  mobileClassName?: string;
}>) {
  return (
    <>
      {mobileClassName ? (
        <Image
          src="/branding/flockfront-logo-final-cropped.png"
          alt="FlockFront"
          width={1549}
          height={236}
          priority
          className={`h-auto object-contain md:hidden ${mobileClassName}`}
        />
      ) : null}
      <Image
        src="/landing-page/flockfront-logo-final.png"
        alt="FlockFront"
        width={2172}
        height={724}
        priority
        className={`h-auto object-contain ${mobileClassName ? "hidden md:block" : ""} ${className}`}
      />
    </>
  );
}

export default async function FaqPage() {
  const { faqs, hasError } = await loadPublishedFaqs();

  return (
    <main className="min-h-screen bg-[#fffaf1] text-[#10281c]">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-2.5 md:px-8 md:py-2.5 lg:px-10">
        <header className="grid items-center gap-5 py-[19px] md:grid-cols-[1fr_auto_1fr] md:gap-4 md:py-[3px]">
          <Link
            href="/"
            className="inline-flex w-fit justify-self-start rounded-md focus:outline-none focus:ring-2 focus:ring-[#0e4a2d] focus:ring-offset-4 focus:ring-offset-[#fffaf1]"
          >
            <BrandLogo className="md:w-[224px]" mobileClassName="w-[150px]" />
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-7 text-[18px] font-normal text-[#10281c] md:flex"
          >
            <Link className="transition hover:text-[#0e4a2d]" href="/#how-it-works">
              How it works
            </Link>
            <Link className="transition hover:text-[#0e4a2d]" href="/pricing">
              Pricing
            </Link>
            <Link className="transition hover:text-[#0e4a2d]" href="/about">
              About
            </Link>
            <Link
              aria-current="page"
              className="font-semibold text-[#0e4a2d]"
              href="/faq"
            >
              FAQ
            </Link>
          </nav>

          <div className="flex items-center gap-4 justify-start justify-self-start md:justify-self-auto md:justify-end">
            <Link
              className="hidden text-[18px] font-bold text-[#10281c] transition hover:text-[#0e4a2d] md:inline-flex"
              href="/login"
            >
              Log In
            </Link>
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
          className="mt-3 flex items-center justify-center gap-4 rounded-md border border-[#e8deca] bg-white/55 px-2 py-2 text-[16px] font-medium text-[#10281c] sm:gap-5 sm:px-3 sm:text-[18px] md:hidden"
        >
          <Link className="transition hover:text-[#0e4a2d]" href="/#how-it-works">
            How it works
          </Link>
          <Link className="transition hover:text-[#0e4a2d]" href="/pricing">
            Pricing
          </Link>
          <Link className="transition hover:text-[#0e4a2d]" href="/about">
            About
          </Link>
          <Link
            aria-current="page"
            className="font-semibold text-[#0e4a2d]"
            href="/faq"
          >
            FAQ
          </Link>
          <Link className="transition hover:text-[#0e4a2d]" href="/login">
            Log In
          </Link>
        </nav>
      </div>

      <section className="border-y border-[#eee4d4] bg-[#f7f1e6] px-5 py-1 max-[899px]:px-4 md:px-8 md:py-2">
        <div className="mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h1 className="text-balance font-serif text-[clamp(1.35rem,2.8vw,2.475rem)] leading-[0.98] text-[#123d27]">
              Frequently Asked Questions
            </h1>
          </div>

          <Image
            src="/faq-quail-sketch.png"
            alt="Curious quail surrounded by question marks"
            width={1536}
            height={1536}
            priority
            className="ml-auto mr-0 w-full max-w-[102px] -translate-x-[15px] object-contain opacity-60 mix-blend-multiply md:max-w-[121px]"
          />
        </div>
      </section>

      <section className="px-5 py-8 max-[899px]:px-4 md:px-8 md:py-10">
        <div className="mx-auto max-w-5xl">
          {faqs.length > 0 && !hasError ? (
            <FaqAccordion faqs={faqs} />
          ) : (
            <div className="rounded-lg border border-[#e6ddcf] bg-white/72 px-5 py-8 text-center text-[1rem] font-medium leading-7 text-[#303830]">
              FAQ information is being added. Please check back soon.
            </div>
          )}
        </div>
      </section>

      <section className="px-5 pb-12 max-[899px]:px-4 md:px-8 md:pb-14">
        <div className="mx-auto grid max-w-5xl items-center gap-5 rounded-lg border border-[#e8deca] bg-[#f4f0e8] px-5 py-6 md:grid-cols-[1fr_auto] md:px-8">
          <div>
            <h2 className="font-serif text-[1.65rem] font-bold leading-tight text-[#123d27] md:text-[1.95rem]">
              Ready to spend less time managing listings?
            </h2>
            <p className="mt-2 max-w-2xl text-[1rem] leading-7 text-[#303830]">
              Create your FlockFront storefront and keep your poultry listings,
              pricing, and orders in one place.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#0f4329] px-5 text-[15px] font-semibold text-white transition hover:bg-[#0a3220] focus:outline-none focus:ring-2 focus:ring-[#0f4329] focus:ring-offset-4 focus:ring-offset-[#f4f0e8]"
              href="/signup"
            >
              Start Your 7-Day Free Trial
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#123d27] bg-white/55 px-5 text-[15px] font-semibold text-[#123d27] transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#0f4329] focus:ring-offset-4 focus:ring-offset-[#f4f0e8]"
              href={previewStoreHref}
            >
              Preview a Store
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#ddd5c6] bg-white/70 px-5 py-3 max-[899px]:px-4 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 max-[899px]:items-center max-[899px]:gap-3 max-[899px]:text-center md:flex-row md:items-center md:justify-between md:max-[899px]:flex-col">
          <div className="flex items-center gap-3 text-sm max-[899px]:flex-col max-[899px]:gap-1.5">
            <BrandLogo className="w-[173px]" />
            <p className="text-base text-[#394137]">
              Simple tools for poultry sellers.
            </p>
          </div>
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-x-9 gap-y-3 text-base font-medium text-[#303830] max-[899px]:grid max-[899px]:w-full max-[899px]:max-w-xs max-[899px]:grid-cols-2 max-[899px]:justify-items-center max-[899px]:gap-x-4 max-[899px]:gap-y-2"
          >
            <Link className="hover:text-[#0e4a2d]" href="/#how-it-works">
              How it works
            </Link>
            <Link className="hover:text-[#0e4a2d]" href="/pricing">
              Pricing
            </Link>
            <Link className="hover:text-[#0e4a2d]" href="/about">
              About
            </Link>
            <Link className="hover:text-[#0e4a2d]" href="/faq">
              FAQ
            </Link>
            <Link className="hover:text-[#0e4a2d]" href="/login">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
