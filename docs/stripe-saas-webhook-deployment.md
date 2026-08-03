# Stripe SaaS webhook deployment and enrollment boundary

Batch 6 added the receipt ledger, Batch 7 added local verified Checkout
enrollment application, and Batch 8 adds local invoice and Subscription
lifecycle application. Both Edge Functions remain undeployed. Do not deploy
either function or create a Stripe webhook destination until the coordinated
activation review.

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

Batch 8 uses the same operational client read-only to retrieve an Invoice, its
bound Subscription, the single recurring line, Price, and Product. The signed
event object ID, immutable Customer and Subscription bindings, account, mode,
catalog values, currency, collection method, amounts, and recurring service
period must all agree before PostgreSQL applies the event. The client does not
pay, finalize, void, update, or otherwise mutate an Invoice or Subscription.

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

## Invoice and Subscription lifecycle authority

The four approved Invoice events and the three approved Subscription snapshot
events remain deferred until the webhook service obtains an active fenced
reconciliation claim. Their typed database application and provider-event
finalization occur in the same transaction.

Only a positive, automatically collected, verified
`invoice.payment_succeeded` event can extend `paid_through_at`. A zero-dollar
trial Invoice is audit evidence only. Neither an Invoice `paid` field nor a
Subscription `current_period_end` value is payment authority. Payment failure,
action-required, and finalization-failure events can schedule grace only for a
trial conversion or ordinary recurring renewal. Grace ends exactly three days
after the verified trial end or existing paid-through boundary. A later
verified payment advances paid-through monotonically and clears matching or
older failure and grace state.

Enrollment-backed Subscription created, updated, and deleted events update
provider status, scheduling, and cancellation snapshots only. They cannot
extend paid-through. Period-end or terminal cancellation cannot shorten access
already proven by a paid Invoice, does not create grace by itself, and does not
alter the seller's storefront preference or delete seller data.
