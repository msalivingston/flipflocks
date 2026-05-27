# Group 33 Seller UI Scaffold & Frontend Structure Review

Group 33 inspects the current frontend and adds only the seller shell plus the first thin dashboard slice. It does not create a new seller backend layer, migrations, Docker setup, local Supabase setup, or full seller screens.

## Frontend Structure Review

App framework:

- Next.js `16.2.6` with React `19.2.4`.
- The project uses the `app` directory and App Router.
- Next 16 docs were checked in `node_modules/next/dist/docs/01-app/...`; folders define route segments, `page.tsx` exposes pages, nested `layout.tsx` files wrap child routes, and `NEXT_PUBLIC_` variables are bundled for browser use.

Routing framework:

- File-system App Router.
- Existing public/store routes before Group 33:
  - `/`
  - `/login`
  - `/dashboard`
  - `/listings`
  - `/store/[slug]`
  - `/test-supabase`
- Existing `/store/[slug]` uses a dynamic App Router segment with `params: Promise<{ slug: string }>`, matching this Next version's documented pattern.

Existing page structure:

- `app/layout.tsx` root layout.
- `app/page.tsx` marketing/home page.
- `app/login/page.tsx` client-side seller login.
- `app/dashboard/page.tsx` was an early client-side test dashboard with direct batch/inventory writes.
- `app/listings/page.tsx` is a top-level transitional listing test page that queries a `listings` table shape.
- `app/store/[slug]/page.tsx` reads `public_storefront_inventory`.

Existing components:

- No shared component directory existed before this group.
- UI was inline inside pages.

Styling approach:

- Tailwind CSS v4 is configured through `@import "tailwindcss"` in `app/globals.css`.
- Existing pages also use inline styles.
- Group 33 introduces Tailwind-based seller shell/components while preserving the existing global CSS entry point.

Auth/session pattern:

- Existing login uses `supabase.auth.signInWithPassword(...)` in a client page and redirects with `window.location.href`.
- Existing authenticated reads depend on the browser Supabase session.
- There is no server cookie/session helper yet, so protected seller routes should bootstrap in a client shell for now.

Supabase client pattern:

- `lib/supabase.ts` exports a singleton Supabase browser client created with:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- No generated database types are present.
- Existing reads and mutations use `supabase.from(...)` and `supabase.rpc(...)` directly.

API/data-fetching pattern:

- Public pages currently use server components with the anon client for public projections.
- Seller-private routes should use client components because auth is currently browser-session based.
- Group 33 uses `get_seller_context()`, `seller_dashboard_home`, `seller_order_management`, and `seller_inventory_management`.

Environment variable usage:

- Only public Supabase browser variables are used in application code.
- `.env*` files are ignored by git.
- No service role key is used in the Next app, which is correct for seller UI.

Seller/public route conventions:

- Public storefront route is `/store/[slug]`.
- Seller routes are consolidated under `/dashboard/*`.
- Existing top-level `/listings` should be considered a transitional alias or removed later; it should not become the long-term seller route family.

## Proposed Seller Route/File Map

| Navigation | Route | File |
| --- | --- | --- |
| Dashboard | `/dashboard` | `app/dashboard/page.tsx` |
| Listings | `/dashboard/listings` | `app/dashboard/listings/page.tsx` |
| New Listing | `/dashboard/listings/new` | `app/dashboard/listings/new/page.tsx` |
| Orders | `/dashboard/orders` | `app/dashboard/orders/page.tsx` |
| Customers | `/dashboard/customers` | `app/dashboard/customers/page.tsx` |
| Storefront | `/dashboard/storefront` | `app/dashboard/storefront/page.tsx` |
| Reports | `/dashboard/reports` | `app/dashboard/reports/page.tsx` |
| Account | `/dashboard/account` | `app/dashboard/account/page.tsx` |
| Public Storefront | `/store/[slug]` | `app/store/[slug]/page.tsx` |

Future detail routes should stay full-screen, especially on mobile:

- `/dashboard/listings/[listingBatchId]`
- `/dashboard/listings/[listingBatchId]/quick-edit`
- `/dashboard/orders/[orderId]`
- `/dashboard/customers/[customerId]`

## SellerAppShell Design

Desktop navigation:

- Persistent left sidebar.
- Store identity and public storefront link anchored near the bottom.
- Page content uses a shared header and full-width content region.

Mobile navigation:

- Compact top app bar.
- Bottom horizontally scrollable primary navigation covering all approved seller sections.
- Detail pages should be full-screen routes, not slide-overs.

Shared page header:

- Eyebrow/store context where useful.
- Title.
- Short operational description.
- Optional primary action.

Loading, error, and empty states:

- Seller route bootstrap shows a full-page loading state.
- Bootstrap failures show a reusable error state with retry.
- Screen-level empty states explain the immediate seller action without exposing backend concepts.

Protected seller-route behavior:

- `app/dashboard/layout.tsx` wraps all seller routes in `SellerAppShell`.
- The shell calls `supabase.auth.getUser()`.
- If no authenticated user exists, it redirects to `/login`.
- It then calls `get_seller_context()` and blocks child rendering until a seller store is loaded.

Seller-context bootstrap:

- First matching context row is used as the active store for V1.
- Multi-store switching is reserved for later.
- The context is shared through `useSellerContext()`.

## Shared UI Components Added

- `SellerAppShell`
- `SellerContextProvider`
- `useSellerContext`
- `SellerPageHeader`
- `SellerCard`
- `StatusBadge`
- `EmptyState`
- `LoadingState`
- `ErrorState`
- `ActionMenu`
- `ContactActionButtons`
- `PrimaryActionLink`

Recommended next shared components before full screens:

- `SellerTable`
- `SellerCardList`
- `SellerToolbar`
- `SellerTabs`
- `FilterControl`
- `FullScreenMobileDetailLayout`
- `SaveBar`
- `ConfirmActionDialog`

## First Practical UI Slice

Implemented first slice:

- Protected `/dashboard` seller shell.
- Seller context bootstrap using `get_seller_context()`.
- Dashboard projection read using `seller_dashboard_home`.
- Recent order read using `seller_order_management`.
- Active listing summary read using `seller_inventory_management`.
- Desktop sidebar navigation.
- Mobile top bar plus bottom seller navigation.
- Placeholder scaffold routes for the remaining approved seller sections.

This proves:

- Routing works under `/dashboard/*`.
- Browser-session auth works for seller-private UI.
- Seller context loads.
- Dashboard projection loads.
- Desktop and mobile navigation can move between seller sections.
- Shared layout primitives are usable.

## Proven Blockers

No new backend blocker was proven for this scaffold and dashboard slice.

Known deferred work remains:

- Equipment & Supplies backend is deferred.
- Full media UI should use Group 32B upload and media management contracts.
- Stripe seller billing workflows remain later.

