import { AdminPageHeader } from "../_components/admin-ui";
import { StripeSubscriptionResyncForm } from "./stripe-subscription-resync-form";

export default function StripeSubscriptionResyncPage() {
  return (
    <>
      <AdminPageHeader
        eyebrow="Temporary operation"
        title="Refresh verified Stripe subscription"
        description="Read the current immutable Stripe subscription and refresh only its verified scheduling snapshot."
      />
      <div className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
        <StripeSubscriptionResyncForm />
      </div>
    </>
  );
}
