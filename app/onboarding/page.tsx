import Link from "next/link";
import { OnboardingShell } from "./_components/onboarding-shell";

export const metadata = {
  title: "FlockFront onboarding",
  description: "Continue setting up your FlockFront seller storefront.",
};

export default function OnboardingPage() {
  return (
    <OnboardingShell currentStep={2}>
      <section className="rounded-[1.15rem] bg-white px-6 py-7 shadow-[0_18px_54px_rgba(45,35,20,0.14)] ring-1 ring-stone-200/80 sm:px-9 sm:py-10 lg:px-14 lg:py-12">
        <p className="text-sm font-extrabold uppercase text-[#28713a]">
          Step 2 coming next
        </p>
        <h2 className="mt-4 font-serif text-[2.15rem] font-bold leading-tight text-stone-950 sm:text-[2.75rem]">
          Account created.
        </h2>
        <p className="mt-4 text-lg font-semibold leading-8 text-stone-700">
          Next we&apos;ll set up your farm details.
        </p>
        <p className="mt-5 text-base leading-7 text-stone-500">
          This placeholder keeps you in the onboarding flow without creating a
          store record yet. Farm basics, contact details, categories, pickup,
          trial access, and review will be added in later steps.
        </p>
        <div className="mt-8 border-t border-stone-200 pt-5">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-[#246f38] px-6 text-base font-extrabold text-white transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2"
            href="/"
          >
            Back to FlockFront
          </Link>
        </div>
      </section>
    </OnboardingShell>
  );
}
