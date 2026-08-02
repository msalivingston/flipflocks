# Stripe SaaS catalog registration

Batch 4 verifies existing Stripe sandbox Products and Prices. It never creates, edits, archives, or activates Stripe objects. Products and Prices are created manually in the Stripe Dashboard, then the local tool verifies the provider values before asking the service-only database contract to trust them.

Create a sandbox restricted key with exactly these permissions:

- Products: Read
- Prices: Read
- Everything else: None

No Accounts permission is required. The utility does not call the Stripe Accounts API.

## Server-only configuration

| Variable | Classification | Purpose |
|---|---|---|
| `STRIPE_SAAS_API_KEY` | Secret, not used by this utility | Reserved for future FlockFront SaaS billing operations. Catalog dry-run and apply do not require or read it. |
| `STRIPE_SAAS_CATALOG_READ_KEY` | Secret, prompted when absent | Least-privilege Stripe restricted test key for Product and Price reads. An existing server environment value takes precedence; the utility never falls back to the operational key. |
| `STRIPE_PLATFORM_ACCOUNT_ID` | Safe identifier | Defaults to the manually confirmed local sandbox binding `acct_1CTOghL1R5g4hhXt`. Supplied values are still validated. |
| `STRIPE_SAAS_LIVEMODE` | Safe setting | Defaults to `false` for this local utility. Supplied values are still validated, and live mode is refused. |
| `FLOCKFRONT_ENVIRONMENT_ID` | Safe identifier | Defaults to `local` for this utility. Supplied values must be `local`, `development`, `test`, `preview`, `staging`, or `production`. |
| `SUPABASE_URL` | Sensitive deployment configuration | Needed only for apply mode. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Needed only for apply mode; never browser-exposed. |

Keep secrets out of source files. No Stripe variable is browser-public. Use the sandbox restricted key for catalog inspection and do not grant it permissions beyond Products: Read and Prices: Read. The local defaults above apply only to this catalog utility; shared operational Stripe configuration remains strict and has no equivalent defaults.

Product and Price evidence is retrieved and verified from Stripe. The configured account ID is validated operator configuration, not provider-retrieved evidence. Successful sandbox Product and Price retrieval proves those objects are accessible to the sandbox key; it does not independently verify the configured textual account ID.

## Usage

The approved operator workflow verifies all four sandbox Prices in one process, with one key acquisition and one shared Stripe client:

```text
npm run stripe:verify-saas-catalog
```

When no automation key is already configured, the command opens a temporary local browser form titled **Verify FlockFront Stripe Catalog**. Paste the restricted test key into the password field and select **Verify**. The form is served only from a random, single-use `127.0.0.1` URL, expires shortly, saves nothing, and closes its listener immediately after submission.

Verification progress and the final PASS/FAIL table appear in both the browser and terminal. The verifier always performs read-only dry-run verification, makes no Supabase mutation, and continues after an individual Price failure. Coop monthly and yearly must resolve to the approved Coop Product; Market monthly and yearly must resolve to the approved Market Product.

For automation, an existing `STRIPE_SAAS_CATALOG_READ_KEY` is used without opening the browser. The verifier never uses terminal raw-mode input, clipboard acquisition, a key file, `STRIPE_SAAS_API_KEY`, or Supabase configuration.

### Individual Price debugging

The individual utility remains available when a specific Price needs diagnosis:

```text
npm run stripe:register-saas-price -- --plan=small_flock --cadence=monthly --price-id=<test-price-id>
```

Apply additionally requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `--apply`, an exact environment confirmation, and an exact configured-account confirmation. Supabase configuration is checked only after the confirmations and Stripe Product and Price verification succeed:

```text
npm run stripe:register-saas-price -- --plan=small_flock --cadence=monthly --price-id=<test-price-id> --apply --confirm-environment=<environment-id> --confirm-account=acct_1CTOghL1R5g4hhXt
```

Batch 4 refuses live mode. Output is redacted, and only allowlisted typed attributes go to `register_verified_saas_price`. Price IDs must never be copied into browser code or accepted as browser authority. Test and live configuration must remain separate.
