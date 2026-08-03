import { StripeReturnStatus } from "./stripe-return-status";

type ReturnPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StripeBillingReturnPage({ searchParams }: ReturnPageProps) {
  const params = await searchParams;
  const checkout = firstValue(params.checkout);
  const sessionId = firstValue(params.session_id);

  // Query parameters are presentation hints only. The Session identifier is
  // deliberately reduced to presence/absence and is never sent to an RPC.
  return (
    <StripeReturnStatus
      hasSessionHint={Boolean(sessionId)}
      successHint={checkout === "success"}
    />
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
