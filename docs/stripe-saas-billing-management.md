# FlockFront SaaS billing management deployment notes

Batch 10 adds disabled server-side support for Stripe Billing Portal sessions
and seller-requested subscription resume actions. It does not create either
Portal configuration, deploy an Edge Function, or enable a feature flag.

Future deployments require these server-only values:

- `STRIPE_SAAS_API_KEY`
- `STRIPE_PLATFORM_ACCOUNT_ID`
- `STRIPE_SAAS_LIVEMODE`
- `FLOCKFRONT_ENVIRONMENT_ID`
- `FLOCKFRONT_APP_ORIGIN`

The temporary `STRIPE_SAAS_CATALOG_READ_KEY` is unrelated and must not be
used by these functions. No value belongs in source control or a public
environment variable.

The saved default sandbox Portal configuration must allow payment-method
updates, invoice history, and cancellation at the end of the current billing
period. Subscription Product and Price switching, plan changes, cadence
changes, and promotion codes must remain disabled.

FlockFront deliberately omits Stripe's `configuration` parameter when it
creates every Portal Session, so Stripe uses the saved default sandbox
configuration. Payment-method updates and cancellation still use targeted
Portal flows. The `subscription_cancel` flow is bound to the current immutable
Subscription derived by the server. No Portal configuration identifier is a
required runtime variable.

`FLOCKFRONT_APP_ORIGIN` is the fixed return origin. It must use HTTPS outside
local development. The server always returns to
`/dashboard/account?billing=portal_return`; the browser cannot provide a
different destination.

Resume requests update only Stripe's `cancel_at_period_end` setting to false.
They do not write authoritative FlockFront billing state. The verified Stripe
Subscription webhook remains responsible for updating cancellation status and
seller-facing access state.
