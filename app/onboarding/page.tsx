import { OnboardingFlow } from "./_components/onboarding-flow";

export const metadata = {
  title: "FlockFront onboarding",
  description: "Continue setting up your FlockFront seller storefront.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const billing = Array.isArray(params.billing) ? params.billing[0] : params.billing;
  return <OnboardingFlow checkoutCanceled={billing === "checkout_canceled"} />;
}
