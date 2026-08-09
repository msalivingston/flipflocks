import { OnboardingShell } from "../onboarding/_components/onboarding-shell";
import { SignupForm } from "./signup-form";

export const metadata = {
  title: "Create your FlockFront account",
  description: "Start setting up your FlockFront seller storefront.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const resend = Array.isArray(params.resend) ? params.resend[0] : params.resend;

  return (
    <OnboardingShell
      currentStep={1}
      compactOnMobile
      reassurance="Only takes a few minutes."
    >
      <SignupForm initialResendMode={resend === "1"} />
    </OnboardingShell>
  );
}
