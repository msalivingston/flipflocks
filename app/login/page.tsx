import type { Metadata } from "next";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { loadSellerSignupsEnabled } from "@/lib/platform-settings";

export const metadata: Metadata = {
  title: "Sign In | FlockFront",
  description: "Sign in to manage your FlockFront seller dashboard.",
};

export default async function LoginPage() {
  const sellerSignupsEnabled = await loadSellerSignupsEnabled();

  return <SignInForm sellerSignupsEnabled={sellerSignupsEnabled} />;
}
