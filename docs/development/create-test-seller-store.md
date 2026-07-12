# Create a Second Test Seller Store

This is a development-only process for creating a second seller/store so FlockFront can test multi-seller behavior before public seller onboarding exists.

Do not add these scripts to Supabase migrations. They are repeatable utilities for development and test environments only.

## What This Creates

The setup uses the existing auth-to-store ownership model:

- Supabase Auth user signs in with email/password.
- `stores.owner_user_id` points to that Auth user.
- `user_roles` gives the user a store-scoped `seller` role.
- seller context resolves the store through `get_seller_context()`.
- normal RLS still controls access.

The script also creates or updates the related seller setup records:

- `stores`
- `user_roles`
- `seller_billing_status`
- `seller_onboarding_state`
- `seller_terms_acceptances`
- `store_pickup_options`

It does not create an Auth user and does not change RLS.

It also does not directly set protected store lifecycle/admin fields. The store starts in the safest default state allowed by the database:

- `store_status = draft`
- `storefront_enabled = false`
- `storefront_mode = hosted`
- `admin_hold_reason = null`

That means the test seller can use the seller dashboard, store settings, listing creation, inventory, and photo upload flows, but the storefront is not public until the store is launched from Store Admin and the storefront is enabled.

## Why Not Attach A Second Store To The Original Seller?

The seller dashboard currently reads seller context and uses the first matching store. There is no store switcher yet.

For now, use a dedicated Auth user with one dedicated test store. That gives cleaner multi-seller testing and avoids ambiguity about which store the app should load.

## Step 1: Create The Auth User

In Supabase:

1. Open Authentication.
2. Create a new user.
3. Use a unique development email, for example:

   ```text
   seller2@example.test
   ```

4. Set a password you can use locally.
5. Confirm the user or mark the email as confirmed if your Supabase Auth settings require confirmation before login.

Do not insert directly into `auth.users`.

## Step 2: Configure The Create Script

Open:

```text
scripts/create-test-seller-store.sql
```

Edit the values in `dev_test_seller_store_params`, especially:

```sql
'seller2@example.test'::text AS test_user_email,
'test-seller-two'::text AS test_store_slug,
'Test Seller Two'::text AS test_store_name,
```

The email must match the Supabase Auth user. The slug must be unique.

## Step 3: Run The Create Script

Run the full contents of:

```text
scripts/create-test-seller-store.sql
```

Use the Supabase SQL editor or another trusted development database connection.

The script is idempotent. If you run it again with the same email and slug, it updates/reuses the same test seller/store setup instead of creating duplicate store records.

The script returns a verification summary. Confirm:

- `auth_email` is the test seller email
- `store_slug` is the test slug
- `store_status` is `draft`, unless you later launched it from Store Admin
- `storefront_enabled` is `false`, unless you later enabled it in Store Admin
- `is_publicly_available` is usually `false` immediately after running this script
- `has_seller_role` is `true`
- `subscription_status` is `comped`
- `profile_complete`, `billing_complete`, `terms_accepted`, and `ready_to_launch` are `true`
- `has_default_pickup_option` is `true`

## Step 4: Log In As The Test Seller

Open the app and go to:

```text
/login
```

Log in with the test seller email and password.

After login, the dashboard should load the test seller's store. It should not show the original seller's data.

## Launching The Store

The development script does not set `store_status`, `storefront_enabled`, `storefront_mode`, or `admin_hold_reason` directly because those fields are protected by `prevent_non_admin_store_protected_field_mutation()`.

To launch the test store:

1. Log in as the test seller.
2. Open Store Admin.
3. Complete the Launch Readiness required items.
4. Save any Store Admin changes.
5. Click Launch Store.

Launching changes `store_status` from `draft` to `live`. It does not automatically enable `storefront_enabled`.

To make the public storefront visible after launch, use the existing Storefront enabled toggle in Store Admin.

## What To Verify

As the test seller:

1. Open the dashboard.
2. Confirm only the test seller's inventory/orders/listings are visible.
3. Create a listing.
4. Add inventory rows.
5. Upload photos.
6. Publish the listing if the listing workflow allows it for the current store state.
7. Open Store Admin and complete the Launch Readiness required items.
8. Save Store Admin changes, then click Launch Store.
9. Enable the storefront with the Storefront enabled toggle.
10. Open the public storefront for the test slug after launch and publication.
11. Place or simulate an order against the test store.
12. Confirm the order appears only for the test seller.
13. Log back in as the original seller and confirm the test seller's data is not visible.

## Cleanup

Open:

```text
scripts/remove-test-seller-store.sql
```

Edit the values in `dev_test_seller_store_remove_params` so they match the test email and test slug:

```sql
'seller2@example.test'::text AS test_user_email,
'test-seller-two'::text AS test_store_slug;
```

Run the full script from a trusted development database connection.

The cleanup is narrowly scoped by both email and slug. It refuses to run if the slug belongs to a different Auth user.

The cleanup deletes the store-side records and cascaded store-owned development data. It does not delete the Supabase Auth user.

To fully remove the login, delete the test user manually in Supabase Auth after running the cleanup script.

## Notes And Limitations

- This is not public onboarding.
- This does not weaken RLS.
- This does not change app code.
- This does not directly set protected store lifecycle/admin fields.
- Storage bucket objects are not removed by the database cleanup script.
- Use a dedicated Auth user with one test store until the app has a store switcher.
- If a slug already belongs to another user, the create script stops instead of taking over that store.
