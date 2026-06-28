import { OnboardingShell } from "../onboarding/_components/onboarding-shell";
import { SignupForm } from "./signup-form";

export const metadata = {
  title: "Create your FlockFront account",
  description: "Start setting up your FlockFront seller storefront.",
};

export default function SignupPage() {
  return (
    <OnboardingShell currentStep={1}>
      <SignupForm />
    </OnboardingShell>
  );
}
