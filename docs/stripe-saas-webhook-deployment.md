# Stripe SaaS webhook deployment and enrollment boundary

Batch 6 added the receipt ledger and Batch 7 adds local, undeployed verified
Checkout enrollment application. Do not deploy either Edge Function or
create a Stripe webhook destination until the coordinated activation review.

The future Edge Function deployment requires these server-only values:

- `STRIPE_SAAS_WEBHOOK_SECRET`
- `STRIPE_SAAS_API_KEY`
- `STRIPE_PLATFORM_ACCOUNT_ID`
- `STRIPE_SAAS_LIVEMODE`
- `FLOCKFRONT_ENVIRONMENT_ID`

The webhook secret is specific to one Stripe webhook destination and one
environment. Test and live webhook secrets must never be mixed. The temporary
restricted key used by the catalog-registration utility is unrelated and must
not be used here. The operational Stripe API key is not used for signature
verification. After signature verification and a fenced deferred-event claim,
Batch 7 uses the operational key only to retrieve the Checkout Session,
Customer, Subscription, recurring Price, and Product evidence needed for the
atomic enrollment contract. It does not mutate Stripe objects.

Supabase supplies its project URL and service-role credential to the deployed
function according to the repository's existing Edge Function runtime
conventions. Those values remain server-side.

For ordinary FlockFront platform-account events, Stripe does not necessarily
include an `account` field. In that case the platform account ID attached to the
ledger record comes from validated server configuration. If an event does
include `account`, the function requires it to match that configuration. This
must not be described as provider-retrieved account identity.

The webhook is deliberately independent of the Checkout feature flag. Once
deployed, disabling new Checkout creation must not prevent receipt of events
for subscriptions that already exist.

## Deferred versus ignored events

Batch 6 acknowledges approved SaaS events with HTTP 200 after signature
verification and durable receipt, but it does not apply their billing-domain
effects. Those events use the explicit `deferred` processing state and retain
their immutable event ID, payload hash, account, mode, environment, event type,
object identity, and a typed deferred reason. They are not marked applied.

Unsupported event types and the intentionally informational
`customer.subscription.trial_will_end` event use the terminal `ignored` state.
An ignored event cannot be reopened by the deferred-event reconciliation
contract.

A service-role reconciliation workflow claims a deferred event using
its complete original identity. PostgreSQL serializes the claim and issues a
short-lived, single-worker lease token. Conflicting identity or payload hashes
fail closed, a fresh lease cannot be stolen, and processed work cannot be
claimed again. For `checkout.session.completed`, Batch 7 creates immutable
Customer and Subscription bindings, creates a trial claim only when Stripe
actually established the first trial, applies trial entitlement, and marks the
event processed in one database transaction. It never creates paid-through
authority. No raw Stripe payload is accepted from a browser or platform
administrator.
