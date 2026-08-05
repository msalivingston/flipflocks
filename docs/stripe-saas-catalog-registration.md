# Stripe SaaS catalog registration

The catalog utility verifies existing Stripe Products and Prices. It never creates, edits, archives, or activates Stripe objects. Products and Prices are created manually in the Stripe Dashboard, then the local tool verifies the provider values before asking the service-only database contract to trust them.

Create a sandbox restricted key with exactly these permissions:

- Products: Read
- Prices: Read
- Everything else: None

No Accounts permission is required. The utility does not call the Stripe Accounts API.

## Server-only configuration

| Variable | Classification | Purpose |
|---|---|---|
| `STRIPE_SAAS_API_KEY` | Secret, not used by this utility | Reserved for future FlockFront SaaS billing operations. Catalog dry-run and apply do not require or read it. |
| `STRIPE_SAAS_CATALOG_READ_KEY` | Secret, prompted when absent | Least-privilege Stripe restricted key for Product and Price reads in the explicitly selected mode. An existing server environment value takes precedence; the utility never falls back to the operational key. |
| `STRIPE_PLATFORM_ACCOUNT_ID` | Safe identifier | Defaults to the manually confirmed local sandbox binding `acct_1CTOghL1R5g4hhXt`. Supplied values are still validated. |
| `STRIPE_SAAS_LIVEMODE` | Safe setting | Defaults to `false`. Live mode is selected only by the explicit `--live` argument; a supplied environment value must agree with that selection. |
| `FLOCKFRONT_ENVIRONMENT_ID` | Safe identifier | Defaults to `local`; explicit live mode requires `production`. A supplied environment value must agree with the selected mode. |
| `SUPABASE_URL` | Sensitive deployment configuration | Optional apply-mode automation value. The normal owner workflow collects it in the temporary local form. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Optional apply-mode automation value. The normal owner workflow collects it in a password field and never echoes it. |

Keep secrets out of source files. No Stripe variable is browser-public. Use the sandbox restricted key for catalog inspection and do not grant it permissions beyond Products: Read and Prices: Read. The local defaults above apply only to this catalog utility; shared operational Stripe configuration remains strict and has no equivalent defaults.

Product and Price evidence is retrieved and verified from Stripe. The configured account ID is validated operator configuration, not provider-retrieved evidence. Successful sandbox Product and Price retrieval proves those objects are accessible to the sandbox key; it does not independently verify the configured textual account ID.

## Usage

The approved operator workflow verifies all four sandbox Prices in one process, with one key acquisition and one shared Stripe client:

```text
npm run stripe:verify-saas-catalog
```

When no automation key is already configured, the command opens a temporary local browser form titled **Verify FlockFront Stripe Catalog**. Paste the restricted test key into the password field and select **Verify**. The form is served only from a random, single-use `127.0.0.1` URL, expires shortly, saves nothing, and closes its listener immediately after submission.

Verification progress and the final PASS/FAIL table appear in both the browser and terminal. Dry-run is the default, makes no Supabase mutation, and continues after an individual Price failure. Coop monthly and yearly must resolve to the approved Coop Product; Market monthly and yearly must resolve to the approved Market Product.

For automation, an existing `STRIPE_SAAS_CATALOG_READ_KEY` is used without opening the browser. The verifier never uses terminal raw-mode input, clipboard acquisition, a key file, or `STRIPE_SAAS_API_KEY`. Dry-run does not read or require Supabase configuration.

After a successful dry run, the same one-command verifier can register all four verified Prices. Apply validates both confirmations, verifies all four Prices, and only then loads the Supabase service credentials. If any Price fails, none are registered. If all pass, one Supabase client calls only `register_verified_saas_price` once per Price and prints a four-row `registered` or `already_registered` result table:

```text
npm run stripe:verify-saas-catalog -- --apply --confirm-environment=local --confirm-account=acct_1CTOghL1R5g4hhXt
```

In the normal owner workflow, the temporary local apply form asks once for the Stripe restricted test key, HTTPS Supabase project URL, and Supabase service-role key. No terminal environment setup is required. Both keys use password fields; the submitted values stay only in process memory and are never echoed into the browser result or terminal. Fully configured automation may continue supplying `STRIPE_SAAS_CATALOG_READ_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` through the process environment and bypass the browser. Exact replay is safe and reports `already_registered`. Apply does not enable Checkout or Portal feature flags.

### Individual Price debugging

The individual utility remains available when a specific Price needs diagnosis:

```text
npm run stripe:register-saas-price -- --plan=small_flock --cadence=monthly --price-id=<test-price-id>
```

Apply additionally requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `--apply`, an exact environment confirmation, and an exact configured-account confirmation. Supabase configuration is checked only after the confirmations and Stripe Product and Price verification succeed:

```text
npm run stripe:register-saas-price -- --plan=small_flock --cadence=monthly --price-id=<test-price-id> --apply --confirm-environment=<environment-id> --confirm-account=acct_1CTOghL1R5g4hhXt
```

Output is redacted, and only allowlisted typed attributes go to `register_verified_saas_price`. Price IDs must never be copied into browser code or accepted as browser authority. Test and live configuration remain separate.

## Live catalog registration

Live registration is an explicit operator-only mode. It uses the same provider verification and permanent `register_verified_saas_price` RPC as sandbox registration, but selects the approved live manifest, requires an `rk_live_` restricted key with only Products: Read and Prices: Read, and requires the production environment and platform-account confirmations. It never falls back to the operational Stripe key.

The internal Market plan key remains `full_flock`; “Market” is its seller-facing name. The database does not accept `market` as a plan key.

First run the provider-only verification. This opens the single-use loopback form and asks only for the live restricted catalog key:

```text
npm run stripe:verify-saas-catalog -- --live
```

After all four live rows pass, run the apply command. The local form additionally asks for the Supabase project URL and service-role key; no secret is placed in the command line or repository:

```text
npm run stripe:verify-saas-catalog -- --live --apply --confirm-environment=production --confirm-account=acct_1CTOghL1R5g4hhXt
```

The live manifest is:

| Display plan | Internal plan key | Cadence | Price | Product |
|---|---|---|---|---|
| Coop | `small_flock` | Monthly | `price_1U1A6TL1R5g4hhXttRzdEkpO` | `prod_V1CV3zEif7505x` |
| Coop | `small_flock` | Annual | `price_1U1A6TL1R5g4hhXtXV8oONZy` | `prod_V1CV3zEif7505x` |
| Market | `full_flock` | Monthly | `price_1U1A6PL1R5g4hhXtsuBhV0pk` | `prod_V1CVBoupdvldFd` |
| Market | `full_flock` | Annual | `price_1U1A6PL1R5g4hhXtandGNw8C` | `prod_V1CVBoupdvldFd` |

The RPC uniqueness boundary includes account and `stripe_livemode`, so adding these live rows does not replace or mutate the registered sandbox rows.
