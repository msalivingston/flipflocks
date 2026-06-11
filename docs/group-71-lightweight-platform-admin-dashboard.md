# Group 71 - Lightweight Platform Admin Dashboard

Group 71 adds the first internal `/admin` UI slice for platform admins.

## Scope

This pass adds:

- `/admin`
- `/admin/stores`
- `/admin/stores/[storeId]`
- Narrow admin-checked read RPCs for store list, store detail, recent admin activity, and recent order summaries.

The UI is read-only except for browser copy/open-link helpers.

## Security Model

Admin data access is enforced by database RPCs, not by hidden routes.

New RPCs:

- `admin_platform_store_list()`
- `admin_platform_store_detail(uuid)`
- `admin_platform_store_recent_activity(uuid, integer)`
- `admin_platform_store_recent_orders(uuid, integer)`

Each RPC explicitly checks `public.is_admin()` and raises an exception for non-admin users. Owner email is exposed only through these admin-checked RPCs.

The current app uses browser Supabase auth helpers. Client-side access handling is used only for UX; sensitive reads remain behind admin RPC checks.

## Existing Admin Foundation Reused

- `public.is_admin()`
- `public.admin_store_overview`
- `public.admin_order_overview`
- `public.admin_activity_events`

Existing audited admin mutation RPCs remain available in the backend but are not surfaced in this UI pass.

## Explicitly Out Of Scope

- Broad CRUD.
- Store deletion.
- Role management.
- Seller impersonation.
- Payment/refund actions.
- Breed library management.
- Catalog photo upload handling.
- Direct table editing.
- Weakening RLS.
