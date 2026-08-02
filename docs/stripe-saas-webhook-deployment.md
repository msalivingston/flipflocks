# Stripe SaaS webhook deployment boundary

Batch 6 adds a local, undeployed receipt boundary only. Do not deploy it or
create a Stripe webhook destination until the coordinated activation review.

The future Edge Function deployment requires these server-only values:

- `STRIPE_SAAS_WEBHOOK_SECRET`
- `STRIPE_PLATFORM_ACCOUNT_ID`
- `STRIPE_SAAS_LIVEMODE`
- `FLOCKFRONT_ENVIRONMENT_ID`

The webhook secret is specific to one Stripe webhook destination and one
environment. Test and live webhook secrets must never be mixed. The temporary
restricted key used by the catalog-registration utility is unrelated and must
not be used here. The operational Stripe API key is not used for signature
verification.

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

A later service-role reconciliation workflow must claim a deferred event using
its complete original identity. PostgreSQL serializes the claim and issues a
short-lived, single-worker lease token. Conflicting identity or payload hashes
fail closed, a fresh lease cannot be stolen, and processed work cannot be
claimed again. The later domain mutation and terminal event transition must be
performed in one database transaction; no raw Stripe payload is accepted from
a browser or platform administrator.
