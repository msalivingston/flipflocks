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
- `STRIPE_SAAS_PORTAL_PAYMENT_METHOD_CONFIGURATION_ID`

The temporary `STRIPE_SAAS_CATALOG_READ_KEY` is unrelated and must not be
used by these functions. No value belongs in source control or a public
environment variable.

The saved default sandbox Portal configuration must allow payment-method
updates, invoice history, and cancellation at the end of the current billing
period. Its payment-method update feature must reference the exact server-only
`STRIPE_SAAS_PORTAL_PAYMENT_METHOD_CONFIGURATION_ID`. Subscription Product and
Price switching, plan changes, cadence changes, and promotion codes must
remain disabled.

Stripe Checkout does not currently use a reusable Payment Method
Configuration. Each Checkout Session is restricted independently with
`payment_method_types: ["card"]`, and Link is hidden with
`wallet_options.link.display: "never"`. The Portal therefore requires a
dedicated sandbox Payment Method Configuration. Its approved `pmc_...`
identifier is stored only in the Supabase server secret above and the same
configuration is assigned to the default sandbox Portal configuration's
payment-method update feature. Stripe remains responsible for the detailed
method and card-network configuration inside that object.

FlockFront deliberately omits Stripe's `configuration` parameter when it
creates every Portal Session, so Stripe uses the saved default sandbox
configuration. Payment-method updates and cancellation still use targeted
Portal flows. The `subscription_cancel` flow is bound to the current immutable
Subscription derived by the server. No Portal configuration identifier is a
required runtime variable. Before returning a Portal URL, the server retrieves
the configuration Stripe assigned to the Session and verifies that it is the
active default in the expected mode, payment-method updates and invoice history
are enabled, cancellation is at period end with no proration, and all
Subscription Product, Price, cadence, promotion-code, and quantity updates are
disabled. It also requires the assigned Portal configuration to reference the
exact server-approved Payment Method Configuration ID. A missing or mismatched
ID fails closed. FlockFront does not inventory the individual methods inside
that Stripe-managed configuration. An unknown Portal capability or
configuration shape still fails closed.

Stripe has no targeted invoice-history Portal flow. The Account page therefore
uses one general `Manage billing & invoices` action for the Portal home and
invoice history. Payment-method update and cancellation remain separate,
targeted actions.

The global `saas_billing_portal_enabled` setting is only a master switch. A
seller also needs an active row in the service-managed
`saas_billing_portal_store_cohort` ledger. Browser roles cannot read or modify
that ledger, revocation preserves its history, and the deployment migration
adds no store. Both the master flag and cohort membership are required by the
read model, Portal authorization, and resume authorization.

`FLOCKFRONT_APP_ORIGIN` is the fixed return origin. It must use HTTPS outside
local development. The server always returns to
`/dashboard/account?billing=portal_return`; the browser cannot provide a
different destination.

Stripe may schedule cancellation with `cancel_at_period_end=true` or an
explicit `cancel_at` equal to the verified current-period boundary. FlockFront
preserves both literal provider facts and exposes one normalized scheduled-
cancellation state. For a trial, the explicit boundary must also equal the
verified trial end.

Resume requests update Stripe's `cancel_at_period_end` setting to false and
clear `cancel_at` using the pinned SDK's supported empty value.
They do not write authoritative FlockFront billing state. The verified Stripe
Subscription webhook remains responsible for updating cancellation status and
seller-facing access state, and completes resume only after both provider
cancellation fields are clear. The matching verified
`customer.subscription.updated` transaction also completes the pending resume
audit record only after immutable Store, Customer, Subscription, enrollment,
account, mode, environment, catalog, and event identity checks have passed.

For controlled rollout, deploy the migration and updated functions while the
master flag remains false. Then use the service-only
`set_saas_billing_portal_store_cohort(store_id, true)` contract for exactly one
internal store before enabling the master flag. Revoke with the same contract
and `false`; do not delete cohort history. If verification fails, disable the
master flag first and then revoke the cohort membership.
