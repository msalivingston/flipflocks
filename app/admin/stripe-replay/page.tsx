import { AdminPageHeader } from "../_components/admin-ui";
import { StripeCheckoutReplayForm } from "./stripe-checkout-replay-form";

export default function StripeCheckoutReplayPage() {
  return (
    <>
      <AdminPageHeader
        eyebrow="Temporary operation"
        title="Replay verified Stripe enrollment"
        description="Reconcile one previously verified Checkout completion. This page cannot create a Checkout Session or supply provider evidence."
      />
      <div className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
        <StripeCheckoutReplayForm />
      </div>
    </>
  );
}
