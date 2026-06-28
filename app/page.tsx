import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FlockFront | Simple storefronts for poultry sellers",
  description:
    "A simple storefront and order tool for poultry sellers who want less message chasing and more time for healthy birds.",
};

const placeholderHref = "#";

const benefits = [
  {
    title: "List once",
    copy: "Prices adjust by age so your listing stays current.",
    icon: "/landing-page/calendar-transparent.png",
    alt: "",
  },
  {
    title: "One clean storefront",
    copy: "Your birds, eggs, products, and equipment in one simple place.",
    icon: "/landing-page/store-transparent.png",
    alt: "",
  },
  {
    title: "Easy pickup orders",
    copy: "Customers order online. You confirm. They pick up.",
    icon: "/landing-page/shopping-bag-transparent.png",
    alt: "",
  },
];

const steps = [
  {
    number: "1",
    title: "Sign up",
    copy: "Create your account in minutes.",
    icon: "/landing-page/user-transparent.png",
    alt: "",
  },
  {
    number: "2",
    title: "Add your birds",
    copy: "List your birds, prices, and pickup details.",
    icon: "/landing-page/chicken-transparent.png",
    alt: "",
  },
  {
    number: "3",
    title: "Share your link",
    copy: "Share your storefront. Get orders.",
    icon: "/landing-page/link-transparent.png",
    alt: "",
  },
];

const farmBullets = [
  {
    copy: "Made to help you list birds straight from the barn.",
    icon: "/landing-page/chicken-transparent.png",
  },
  {
    copy: "Keep pricing current as chicks grow.",
    icon: "/landing-page/growth-chart-transparent.png",
  },
  {
    copy: "Manage orders without chasing messages.",
    icon: "/landing-page/speech-bubble-transparent.png",
  },
];

function PlaceholderLink({
  children,
  className,
  href = placeholderHref,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
  href?: string;
}>) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function BrandLogo({
  className = "",
  variant = "default",
}: Readonly<{
  className?: string;
  variant?: "default" | "hero";
}>) {
  return (
    <Image
      src={
        variant === "hero"
          ? "/landing-page/flockfront-logo-white-darkgreen.png"
          : "/landing-page/flockfront-logo-transparent.png"
      }
      alt="FlockFront"
      width={2172}
      height={724}
      priority
      className={`h-auto object-contain ${className}`}
    />
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-[#163824]">
      <section className="relative isolate min-h-[530px] overflow-hidden text-white md:min-h-[560px]">
        <Image
          src="/landing-page/hero-image.png"
          alt="Chickens in a pasture near a barn at golden hour"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[78%_center] brightness-105"
        />
        <div className="absolute inset-0 bg-[#160f08]/28" />
        <div className="absolute inset-0 bg-linear-to-b from-black/46 via-black/20 to-black/34" />

        <div className="relative z-10 mx-auto flex min-h-[530px] w-full max-w-7xl flex-col px-5 py-5 md:min-h-[560px] md:px-8 md:py-6 lg:px-12">
          <header className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
            <PlaceholderLink className="inline-flex w-fit items-center">
              <BrandLogo variant="hero" className="w-[225px] md:w-[295px]" />
            </PlaceholderLink>

            <nav
              aria-label="Primary navigation"
              className="hidden items-center gap-10 text-[19px] font-normal text-white/90 md:flex"
            >
              <PlaceholderLink className="transition hover:text-white">
                How it works
              </PlaceholderLink>
              <PlaceholderLink className="transition hover:text-white">
                Pricing
              </PlaceholderLink>
              <PlaceholderLink className="transition hover:text-white" href="/login">
                Sign in
              </PlaceholderLink>
            </nav>

            <div className="flex justify-start md:justify-end">
              <PlaceholderLink
                className="inline-flex min-h-12 items-center justify-center rounded-md bg-[#075f38] px-6 text-[18px] font-normal text-white shadow-sm shadow-black/15 transition hover:bg-[#064a2d]"
                href="/signup"
              >
                Sign up now
              </PlaceholderLink>
            </div>
          </header>

          <div className="mx-auto flex max-w-5xl flex-1 flex-col items-center justify-center py-10 text-center md:pb-14 md:pt-10">
            <h1 className="text-balance font-serif text-[clamp(2.05rem,3.5vw,3.35rem)] leading-[1.05]">
              A better way to sell poultry.
              <br />
              List your birds once, sell from one simple link.
            </h1>
            <p className="mt-5 max-w-2xl text-balance text-lg font-medium leading-8 text-white/95 md:text-[23px] md:leading-9">
              FlockFront gives poultry sellers a simple storefront and order
              tool&mdash;so you can stop chasing messages and focus on raising
              healthy birds.
            </p>
          </div>
        </div>
      </section>

      <section aria-label="FlockFront benefits" className="px-5 py-4 md:px-8 md:py-5">
        <div className="mx-auto grid max-w-6xl overflow-hidden rounded-lg border border-[#e8e0d4] bg-white shadow-[0_8px_24px_rgb(39_31_18/0.035)] md:grid-cols-3">
          {benefits.map((benefit, index) => (
            <article
              key={benefit.title}
              className={`flex items-center gap-4 px-5 py-4 md:px-6 md:py-4 ${
                index > 0 ? "border-t border-[#e7dfd2] md:border-t-0 md:border-l" : ""
              }`}
            >
              <div className="grid size-[4.5rem] shrink-0 place-items-center rounded-full bg-[#f0ede7]">
                <Image
                  src={benefit.icon}
                  alt={benefit.alt}
                  width={52}
                  height={52}
                  className="size-[52px] object-contain"
                />
              </div>
              <div>
                <h2 className="font-serif text-[1.45rem] font-bold leading-tight text-[#133d26]">
                  {benefit.title}
                </h2>
                <p className="mt-2 max-w-60 text-[16px] leading-6 text-[#2b332c]">
                  {benefit.copy}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="px-5 py-3 md:px-8" aria-labelledby="how-it-works">
        <div className="mx-auto max-w-5xl text-center">
          <h2
            id="how-it-works"
            className="font-serif text-[1.8rem] font-bold text-[#0e4a2d] md:text-[2.05rem]"
          >
            How it works
          </h2>

          <div className="mt-4 grid gap-6 md:grid-cols-3 md:items-start">
            {steps.map((step, index) => (
              <article key={step.title} className="relative px-4">
                {index < steps.length - 1 ? (
                  <div
                    aria-hidden="true"
                    className="absolute left-[63%] top-5 hidden h-px w-[62%] border-t border-dashed border-[#c9c1b5] md:block"
                  />
                ) : null}
                <div className="relative mx-auto grid size-10 place-items-center rounded-full bg-[#ccd2b5] text-[17px] font-bold text-[#15391f]">
                  {step.number}
                </div>
                <Image
                  src={step.icon}
                  alt={step.alt}
                  width={58}
                  height={58}
                  className="mx-auto mt-3 size-[58px] object-contain"
                />
                <h3 className="mt-3 text-[17px] font-extrabold text-[#124326]">
                  {step.title}
                </h3>
                <p className="mx-auto mt-2 max-w-48 text-[15px] leading-5 text-[#303830]">
                  {step.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-4 md:px-8">
        <div className="mx-auto grid max-w-6xl items-center gap-5 overflow-hidden rounded-lg border border-[#e8e0d4] bg-[#f4f0e8] px-5 py-6 shadow-[0_8px_24px_rgb(39_31_18/0.035)] md:grid-cols-[0.72fr_1.68fr] md:px-8 md:py-6">
          <div>
            <h2 className="whitespace-nowrap font-serif text-[1.8rem] font-bold leading-tight text-[#0e4a2d] md:text-[2rem]">
              Built on a small farm.
            </h2>
            <ul className="mt-4 space-y-3 text-[16px] font-medium leading-6 text-[#2b332c]">
              {farmBullets.map((bullet) => (
                <li key={bullet.copy} className="flex items-center gap-3">
                  <Image
                    src={bullet.icon}
                    alt=""
                    width={44}
                    height={44}
                    className="size-11 shrink-0 object-contain opacity-85"
                  />
                  <span>{bullet.copy}</span>
                </li>
              ))}
            </ul>
          </div>
          <Image
            src="/landing-page/barn-sketch.png"
            alt="Line-art illustration of a small farm with a barn, tree, fence, and chickens"
            width={2172}
            height={724}
            className="w-full object-contain opacity-78 mix-blend-multiply md:max-h-[236px]"
          />
        </div>
      </section>

      <section className="px-5 py-4 md:px-8">
        <div className="relative mx-auto grid max-w-6xl items-center overflow-hidden rounded-lg border border-[#e8e0d4] bg-white/72 px-6 py-3.5 text-center shadow-[0_8px_24px_rgb(39_31_18/0.035)] md:grid-cols-[0.85fr_2fr_0.85fr] md:px-8 md:py-3">
          <Image
            src="/landing-page/tree.png"
            alt=""
            width={2172}
            height={724}
            className="mx-auto hidden max-h-28 w-full max-w-[330px] object-contain object-left opacity-64 mix-blend-multiply md:block"
          />
          <div>
            <h2 className="font-serif text-[1.7rem] font-bold leading-tight text-[#0e4a2d] md:whitespace-nowrap md:text-[1.95rem]">
              Ready to simplify how you sell?
            </h2>
            <p className="mt-1 text-[16px] text-[#303830]">
              Join FlockFront and start selling with confidence.
            </p>
            <PlaceholderLink
              className="mt-3 inline-flex min-h-11 items-center justify-center gap-3 rounded-md bg-[#08633c] px-7 text-[17px] font-bold text-white shadow-sm transition hover:bg-[#064b2f]"
              href="/signup"
            >
              Sign up now
              <span aria-hidden="true" className="text-xl leading-none">
                &rarr;
              </span>
            </PlaceholderLink>
          </div>
          <Image
            src="/landing-page/pickup-truck-flipped.png"
            alt=""
            width={2172}
            height={724}
            className="mx-auto hidden max-h-28 w-full max-w-[330px] object-contain object-right opacity-64 mix-blend-multiply md:block"
          />
        </div>
      </section>

      <footer className="border-t border-[#ddd5c6] bg-white/70 px-5 py-3 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 text-sm">
            <BrandLogo className="w-[150px]" />
            <p className="text-base text-[#394137]">
              Simple tools for poultry sellers.
            </p>
          </div>
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-x-9 gap-y-3 text-base font-medium text-[#303830]"
          >
            <PlaceholderLink className="hover:text-[#0e4a2d]">
              How it works
            </PlaceholderLink>
            <PlaceholderLink className="hover:text-[#0e4a2d]">
              Pricing
            </PlaceholderLink>
            <PlaceholderLink className="hover:text-[#0e4a2d]" href="/login">
              Sign in
            </PlaceholderLink>
            <PlaceholderLink className="hover:text-[#0e4a2d]">
              Contact
            </PlaceholderLink>
          </nav>
        </div>
      </footer>
    </main>
  );
}
