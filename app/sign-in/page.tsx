import type { Metadata } from "next";
import { loadSellerSignupsEnabled } from "@/lib/platform-settings";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign In | FlockFront",
  description: "Sign in to manage your FlockFront seller dashboard.",
};

export default async function SignInPage() {
  const sellerSignupsEnabled = await loadSellerSignupsEnabled();

  return <SignInForm sellerSignupsEnabled={sellerSignupsEnabled} />;
}
