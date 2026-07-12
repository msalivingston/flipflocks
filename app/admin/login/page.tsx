import type { Metadata } from "next";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = {
  title: "Platform Admin Sign In | FlockFront",
  description: "Sign in to the FlockFront platform administration area.",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const initialError =
    params.error === "platform-admin-required"
      ? "This login is for platform administrators only."
      : undefined;

  return <AdminLoginForm initialError={initialError} />;
}
