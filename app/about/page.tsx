import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MobileMarketingMenu } from "../_components/mobile-marketing-menu";
import { PublicSignupCta } from "../_components/public-signup-cta";
import { loadSellerSignupsEnabled } from "@/lib/platform-settings";

export const metadata: Metadata = {
  title: "About | FlockFront",
  description:
    "Learn why FlockFront was built for poultry sellers and the farm life behind it.",
};

const mobileNavLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/login", label: "Log In" },
];

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

export default async function AboutPage() {
  const sellerSignupsEnabled = await loadSellerSignupsEnabled();

  return (
    <main className="min-h-screen bg-[#fffaf1] text-[#10281c]">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-2.5 md:px-8 md:py-2.5 lg:px-10">
        <header className="relative grid grid-cols-[auto_1fr] items-center gap-4 py-2 md:grid-cols-[1fr_auto_1fr] md:gap-4 md:py-[3px]">
          <Link
            href="/"
            className="inline-flex w-fit justify-self-start rounded-md focus:outline-none focus:ring-2 focus:ring-[#0e4a2d] focus:ring-offset-4 focus:ring-offset-[#fffaf1]"
          >
            <BrandLogo className="md:w-[224px]" mobileClassName="w-[132px] min-[420px]:w-[150px]" />
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
            <Link
              aria-current="page"
              className="font-semibold text-[#0e4a2d]"
              href="/about"
            >
              About
            </Link>
            <Link className="transition hover:text-[#0e4a2d]" href="/faq">
              FAQ
            </Link>
          </nav>

          <div className="flex items-center gap-2 justify-self-end md:gap-4 md:justify-self-auto md:justify-end">
            <Link
              className="hidden text-[18px] font-bold text-[#10281c] transition hover:text-[#0e4a2d] md:inline-flex"
              href="/login"
            >
              Log In
            </Link>
            <PublicSignupCta
              className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-[#b77918] bg-transparent px-3 text-[15px] font-semibold text-[#a86908] transition hover:bg-[#fff4df] focus:outline-none focus:ring-2 focus:ring-[#0e4a2d] focus:ring-offset-4 focus:ring-offset-[#fffaf1] min-[420px]:px-4"
              disabledClassName="hover:bg-transparent"
              sellerSignupsEnabled={sellerSignupsEnabled}
            >
              Get Started
            </PublicSignupCta>
            <MobileMarketingMenu
              currentHref="/about"
              links={mobileNavLinks}
              variant="light"
            />
          </div>
        </header>
      </div>

      <section className="relative overflow-hidden border-y border-[#eee4d4] bg-[#f7f1e6]">
        <div className="absolute inset-y-0 left-1/2 w-full max-w-[1916px] -translate-x-1/2">
          <Image
            src="/about-page/about-banner-goose-20260714-1406.png"
            alt="White goose standing in grass on the farm"
            fill
            priority
            sizes="(min-width: 1916px) 1916px, 100vw"
            className="object-cover object-bottom max-[899px]:object-[94%_bottom]"
          />
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 hidden h-[46%] bg-linear-to-b from-[#10281c]/50 via-[#10281c]/20 to-transparent max-[899px]:block"
        />

        <div className="relative mx-auto grid max-w-5xl items-center md:min-h-[390px] md:grid-cols-[0.9fr_1.1fr]">
          <div className="px-5 py-12 max-[899px]:px-4 max-[899px]:pb-2 max-[899px]:pt-8 md:px-0 md:py-20">
            <h1 className="text-balance font-serif text-[clamp(2.25rem,4.2vw,3.9rem)] leading-[1.02] text-[#123d27] max-[899px]:text-[#fffaf1] max-[899px]:drop-shadow-[0_2px_8px_rgb(16_40_28/0.5)]">
              About FlockFront
            </h1>
            <p className="mt-4 max-w-2xl text-balance text-[1.1rem] leading-7 text-[#6d532b] max-[899px]:mt-2 max-[899px]:max-w-[18rem] max-[899px]:font-semibold max-[899px]:leading-6 max-[899px]:text-[#fff4df] max-[899px]:drop-shadow-[0_2px_7px_rgb(16_40_28/0.55)] md:text-[1.25rem]">
              Built for poultry sellers. Shaped by real farm life.
            </p>
          </div>

          <div className="min-h-[250px] md:hidden" aria-hidden="true" />
        </div>
      </section>

      <section className="px-5 py-[25px] max-[899px]:px-4 md:px-8 md:py-[33px]">
        <div className="mx-auto max-w-3xl">
          <p className="font-serif text-[1.35rem] leading-[1.5] text-[#123d27] md:text-[1.55rem]">
            After ten years of selling poultry, I have learned that a good
            online storefront sells more birds and saves a huge amount
            of time.
          </p>

          <div className="mt-7 space-y-6 text-[1.05rem] leading-[1.5] text-[#243027]">
            <p>
              Poultry sellers deal with a very particular kind of chaos. Birds
              grow, prices change, availability changes, Facebook posts
              disappear into the void, and buyers still ask what you have five
              minutes after you posted it. Phone calls and texts can take up
              hours of time. No-shows can disrupt a whole day.
            </p>
            <p>
              FlockFront puts the important pieces in one place. Sellers can
              show what is currently available, adjust prices as birds age,
              collect orders, keep customer details organized, and give buyers
              clear information. Buyers get an easy way to shop and order, while
              sellers spend less time repeating themselves, sorting through
              messages, and answering the same questions.
            </p>
            <p>
              There is a bigger purpose behind FlockFront too. I believe raising
              poultry helps people become more self-sufficient, more connected
              to their food, and more thoughtful about how animals are treated.
              Helping independent poultry sellers succeed means helping more
              families raise their own food and supporting a more humane
              alternative to industrial poultry production.
            </p>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#f4f0e8] px-5 py-[25px] max-[899px]:px-4 md:px-8 md:py-[33px]">
        <Image
          src="/about-page/farm-gate-sketch.png"
          alt=""
          width={2048}
          height={675}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-full w-full object-cover object-bottom opacity-[0.1] mix-blend-multiply"
        />
        <div className="relative mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-[1fr_0.88fr]">
          <div>
            <h2 className="font-serif text-[2rem] leading-tight text-[#123d27] md:text-[2.45rem]">
              Who We Are
            </h2>
            <div className="mt-5 space-y-5 text-[1.02rem] leading-[1.5] text-[#243027]">
              <p>
                FlockFront is built by Michelle and David Livingston, a
                husband-and-wife team in western Colorado. We live on a small
                farm with far too many birds, a constant list of projects, and
                more poultry pens than we ever planned to own.
              </p>
              <p>
                We have spent years building a life around animals,
                agriculture, and work that feels useful. FlockFront is the
                latest version of that. It is a small business built at our
                kitchen table, shaped by real farm life, and made for other
                people doing the same kind of work.
              </p>
            </div>
          </div>

          <div className="relative min-h-[260px] overflow-hidden rounded-lg shadow-[0_8px_24px_rgb(39_31_18/0.08)] md:min-h-[330px]">
            <Image
              src="/about-page/who-we-are-livingstons.png"
              alt="Michelle and David Livingston in western Colorado"
              fill
              sizes="(min-width: 768px) 420px, 100vw"
              className="-translate-y-[10px] scale-[1.08] object-cover object-top"
            />
          </div>
        </div>
      </section>

      <footer className="relative overflow-hidden border-t border-[#ddd5c6] bg-[#f7f1e6] px-5 py-7 max-[899px]:px-4 md:px-8 md:py-8">
        <div className="relative mx-auto flex max-w-6xl flex-col gap-4 max-[899px]:items-center max-[899px]:gap-3 max-[899px]:text-center md:flex-row md:items-center md:justify-between md:max-[899px]:flex-col">
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
            <Link
              aria-current="page"
              className="font-semibold text-[#0e4a2d]"
              href="/about"
            >
              About
            </Link>
            <Link className="hover:text-[#0e4a2d]" href="/faq">
              FAQ
            </Link>
            <Link className="hover:text-[#0e4a2d]" href="/login">
              Sign in
            </Link>
            <Link className="hover:text-[#0e4a2d]" href="mailto:hello@flockfront.com">
              Contact
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
