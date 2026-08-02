# Stripe SaaS catalog registration

Batch 4 verifies existing Stripe test Products and Prices. It never creates, edits, archives, or activates Stripe objects. Products and Prices are created manually in the Stripe Dashboard, then the local tool verifies the provider values before asking the service-only database contract to trust them.

## Server-only configuration

| Variable | Classification | Purpose |
|---|---|---|
| `STRIPE_SAAS_API_KEY` | Secret | Future FlockFront SaaS billing operations; must match configured mode. |
| `STRIPE_SAAS_CATALOG_READ_KEY` | Secret, optional | Least-privilege Stripe restricted key for Product and Price reads. |
| `STRIPE_PLATFORM_ACCOUNT_ID` | Safe identifier | Exact FlockFront platform account binding. |
| `STRIPE_SAAS_LIVEMODE` | Safe setting | Must be exactly `false` for Batch 4 tooling. |
| `FLOCKFRONT_ENVIRONMENT_ID` | Safe identifier | `local`, `development`, `test`, `preview`, `staging`, or `production`. |
| `SUPABASE_URL` | Sensitive deployment configuration | Needed only for apply mode. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Needed only for apply mode; never browser-exposed. |

Keep secrets in server or local secret storage, never source files. No Stripe variable is browser-public. Use a restricted read key for catalog inspection where practical; the tool falls back to the operational server key when it is absent.

## Usage

Dry-run is the default and performs Stripe reads only:

```text
npm run stripe:register-saas-price -- --plan=small_flock --cadence=monthly --price-id=<test-price-id>
```

Apply additionally requires `--apply` and an exact environment confirmation:

```text
npm run stripe:register-saas-price -- --plan=small_flock --cadence=monthly --price-id=<test-price-id> --apply --confirm-environment=<environment-id>
```

Batch 4 refuses live mode. Output is redacted, and only allowlisted typed attributes go to `register_verified_saas_price`. Price IDs must never be copied into browser code or accepted as browser authority. Test and live configuration must remain separate.
