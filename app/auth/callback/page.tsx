import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo-config";
import { AuthCallbackClient } from "./auth-callback-client";

export const metadata: Metadata = {
  title: "Verify your email | FlockFront",
  description: "Finish verifying your FlockFront seller account.",
  robots: NOINDEX_ROBOTS,
};

export default function AuthCallbackPage() {
  return <AuthCallbackClient />;
}
