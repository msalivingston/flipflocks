import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign In | FlockFront",
  description: "Sign in to manage your FlockFront seller dashboard.",
};

export default function SignInPage() {
  return <SignInForm />;
}
