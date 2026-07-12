import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Reset Password | FlockFront",
  description: "Choose a new password for your FlockFront account.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
