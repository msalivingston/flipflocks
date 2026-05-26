# Group 31 Seller UI Foundation

Group 31 defines the seller dashboard experience before UI implementation begins. This document is intentionally a design and architecture review artifact only.

It does not create React components, pages, migrations, schema changes, deployment steps, or new backend workflows.

## Source Inputs

- Approved seller navigation: Dashboard, Listings, Orders, Customers, Storefront, Reports, Account.
- Current mockups for dashboard, listings, listing creation, edit listing, orders, customers, reports, and account.
- Existing backend foundation through Group 30, especially:
  - Group 27 seller dashboard read projections.
  - Group 29 seller-safe mutation RPCs.
  - Group 30 public storefront and pay-at-pickup API boundary.

Where the mockups conflict with approved Group 31 requirements, the approved requirements take precedence.

## Product Principles

- Mobile-first seller experience.
- Meet sellers in their existing mental model.
- Make common actions one tap away.
- Avoid CRM busywork.
- Avoid unnecessary marketplace complexity.
- Seller defaults reduce repetitive entry.
- Advanced seller tools are acceptable when they genuinely save time.
- Design for actual farm operations rather than generic ecommerce patterns.

The seller dashboard should feel operational, not analytical. It should help a seller answer: What is available, what needs pickup coordination, who ordered, and what should I do next?

## Navigation Model

The primary seller navigation is:

- Dashboard
- Listings
- Orders
- Customers
- Storefront
- Reports
- Account

Desktop uses a persistent left sidebar with the store identity anchored near the bottom. Mobile uses a compact top app bar plus a bottom or menu-based primary navigation. Mobile detail workflows should use full-screen pages, not slide-over drawers.

Global seller actions:

- Create Listing.
- View Storefront.
- Notifications.
- Account/store switcher if multi-store support becomes active later.

The Create Listing action should be globally reachable from dashboard, listings, and mobile navigation because listing creation is a high-frequency seller task.

## Complete Route Map

Recommended route structure:

| Route | Screen | Purpose |
| --- | --- | --- |
| `/dashboard` | Dashboard | Seller operational home. |
| `/dashboard/listings` | Listings | Manage listings in By Listing / Batch and By Breed views. |
| `/dashboard/listings/new` | New Listing Start | First branching question: Birds or Equipment & Supplies. |
| `/dashboard/listings/new/birds` | New Bird Listing Flow | Mobile-first creation workflow for bird listings. |
| `/dashboard/listings/new/equipment` | New Equipment Flow | Deferred/lightweight placeholder until equipment requirements are defined. |
| `/dashboard/listings/[listingBatchId]` | Listing Detail / Full Edit | Full listing edit and inventory management. |
| `/dashboard/listings/[listingBatchId]/quick-edit` | Quick Edit | Focused edit page for status, quantities, prices, visibility, photos, or dates. |
| `/dashboard/listings/[listingBatchId]/preview` | Listing Preview | Seller preview of buyer-facing listing within storefront context. |
| `/dashboard/orders` | Orders | Operational order list. |
| `/dashboard/orders/[orderId]` | Order Detail | Full-screen order detail, fulfillment, and customer contact actions. |
| `/dashboard/customers` | Customers | Read-mostly customer list and lookup. |
| `/dashboard/customers/[customerId]` | Customer Detail | Customer profile, editable contact fields, notes, and recent orders. |
| `/dashboard/storefront` | Storefront Settings | Simple V1 storefront management and preview. |
| `/dashboard/reports` | Reports | CSV exports for V1 reports. |
| `/dashboard/account` | Account | Security, billing, notifications, and seller defaults. |
| `/store/[slug]` | Public Storefront | Existing buyer-facing storefront route, linked from seller dashboard. |

Open route decision:

- The current app has top-level `/dashboard` and `/listings`. Group 31 recommends consolidating seller routes under `/dashboard/*` for a coherent seller shell. If the existing app keeps `/listings`, it should redirect to `/dashboard/listings` or be treated as a transitional alias.

## Shell Layout

### Seller App Shell

Recommended hierarchy:

- SellerAppShell
- SellerSidebar
- SellerMobileHeader
- SellerTopActions
- SellerPageHeader
- SellerContentRegion
- SellerNotificationEntry
- SellerStoreIdentity

Desktop:

- Sidebar remains visible at large breakpoints.
- Page header contains title, short contextual subtitle, and primary action.
- Content area uses responsive grids and dense tables where they improve scanning.
- Right-side summary panels are allowed on desktop for order, customer, and listing detail context.

Mobile:

- Sidebar collapses into menu navigation.
- Page header is compact.
- Primary actions move into sticky bottom actions or top-right buttons.
- Detail screens are full-screen routes.
- Tables become card lists with the highest-value fields surfaced first.

Mobile should not depend on hover, side panels, or multi-column context to complete a workflow.

## Screen Inventory

### Dashboard

Purpose:

- Provide a fast operational summary and direct access to the next seller action.

Keep dashboard cards:

- Active Listings.
- Pending Orders.
- Upcoming Pickups.
- Customers.

Remove:

- Total Inventory dashboard card.

Add:

- Storefront quick link.

Dashboard tables:

- Recent Orders.
- Active Listings.

Recommended dashboard structure:

- Header: Dashboard title, welcome line, Create Listing action.
- Summary cards: Active Listings, Pending Orders, Upcoming Pickups, Customers.
- Storefront quick link: public URL, storefront status, View Storefront action.
- Recent Orders: buyer, quantity, selected pickup option, status, contact shortcut.
- Active Listings: listing/batch, available date, inventory rows, remaining, status.

Mobile:

- Summary cards become a two-column grid or stacked list depending on viewport width.
- Recent Orders and Active Listings render as compact cards.
- Storefront quick link should be visible without deep scrolling.

Desktop:

- Summary cards span the top row.
- Recent Orders and Active Listings can sit side by side.
- Storefront quick link can be a compact operational card between summary and tables or part of the header action cluster.

### Listings

Purpose:

- Let sellers manage inventory in either their operational model or the buyer-facing breed model.

Required views:

- By Listing / Batch.
- By Breed.

Both views use the same backend architecture:

- `listing_batches`
- `listing_batch_breeds`
- `inventory_items`
- `seller_breed_profiles`

The toggle changes presentation and workflow, not storage.

By Listing / Batch view:

- Optimized for hatch/acquisition date, available date, batch status, inventory rows, and remaining quantity.
- Best for farm operations and pickup planning.

By Breed view:

- Groups available inventory by breed display name.
- Useful when sellers think in terms of breed availability and buyer questions.
- Should still expose batch/date context inside each breed group.

Recommended listing list controls:

- Search.
- View toggle: By Listing / Batch, By Breed.
- Status filter.
- Availability filter.
- More filters.
- Export, if useful for seller operations.
- Create Listing.

Recommended listing list item actions:

- View/Edit.
- Quick edit.
- Preview listing.
- Pause/hide.
- Mark sold out.
- Duplicate.
- Archive.

Mobile:

- Listing rows become cards.
- The By Listing / Batch versus By Breed toggle remains prominent.
- Card primary tap opens full listing detail.
- Card secondary actions are one tap away through an action menu.

Desktop:

- By Listing / Batch may use a table.
- By Breed may use grouped rows or sections.
- Bulk actions are acceptable but should not dominate V1.

### Create Listing

Purpose:

- Create sellable inventory quickly, especially from a phone.

First question:

```text
What are you selling?
```

Options:

- Birds.
- Equipment & Supplies.

Birds second question:

```text
How would you like to list them?
```

Options:

- Single Breed / Offering.
- Batch / Mixed Group.

Important architecture rule:

- Both bird paths create the exact same backend architecture.
- The seller workflow differs only in how much information is collected and how it is grouped visually.

Recommended bird creation flow:

1. Listing type selection.
2. Bird workflow selection.
3. Listing basics.
4. Inventory rows.
5. Pricing and settings.
6. Photos.
7. Review and publish.

Mobile-first behavior:

- Each step is a full-screen page or full-screen form state.
- Sticky bottom action: Continue, Save Draft, Publish, or Review.
- Draft save is always reachable.
- Step progress should be visible but not visually heavy.
- Editing a previous step from review should return to that step without losing draft data.

Draft auto-save:

- Required for listing creation.
- Save field groups opportunistically after meaningful changes.
- Show subtle saved/saving/error state.
- Draft state must survive navigation away and return.
- Drafts should be resumable from Listings and Dashboard where reasonable.

Defaults:

- Seller defaults should prefill pickup instructions, pickup location, communication email, order notification email, and currency.
- Defaults should never hide the actual submitted values. The seller can override them per listing where supported.

Equipment & Supplies:

- Route and entry point should exist conceptually.
- V1 requirements for equipment fields are not defined in Group 31.
- Do not design equipment as a different backend inventory architecture until future requirements confirm it.

### Edit Listing

Purpose:

- Support both quick operational edits and full listing maintenance.

Supported modes:

- Quick edits.
- Full edit flow.

Do not force a wizard for simple changes.

Quick edits should support:

- Quantity changes.
- Price changes.
- Status/visibility changes.
- Available date changes.
- Basic photos if media support exists.
- Pause, mark sold out, duplicate, archive.

Full edit should support:

- Listing/batch information.
- Inventory rows.
- Breed display/profile choices.
- Listing-level photos.
- Inventory-row photos.
- Pricing and listing-level settings.
- Visibility and storefront preview.

Pricing and settings:

- Remain listing-level.
- Minimum order quantity is deferred and should not be required in V1 UI.

Photos:

- Listing-level photos describe the whole batch/offering.
- Inventory-row photos describe a specific breed/type row.
- Public image fallback should follow the existing architecture: listing/inventory-specific image first, then seller breed profile image.

Mobile:

- Full edit is a full-screen route with section navigation.
- Quick edit is a focused full-screen route, not a drawer.
- Save/cancel actions remain sticky.

Desktop:

- Full edit can use a main form plus a right-side summary/actions column.
- Quick edits can use compact focused pages or inline table editing where safe.

### Orders

Purpose:

- Prioritize pickup operations and customer communication over payment management.

Required additions:

- Pickup Option column.
- Call customer.
- Text customer.
- Email customer.

Recommended order list columns:

- Order number.
- Customer.
- Order date.
- Selected pickup option.
- Item quantity.
- Total.
- Order status.
- Payment status.
- Fulfillment/pickup type.
- Contact actions.
- More actions.

Operational order filters:

- All.
- Needs action.
- Upcoming pickup.
- Pending/open.
- Fulfilled/completed.
- Canceled.
- Payment status filter can exist, but should not be the main mental model.

Order detail should include:

- Customer contact card.
- Call/Text/Email actions.
- Selected pickup option and pickup notes.
- Buyer notes.
- Order items.
- Quantity and fulfillment status.
- Payment summary.
- Notification status if relevant.
- Fulfill/mark complete/cancel actions where allowed.

Mobile:

- Orders render as cards.
- Primary card fields: customer, selected pickup option, status, quantity, and contact actions.
- Tapping an order opens a full-screen detail page.
- The mobile detail page should keep contact actions near the top.

Desktop:

- Table list is appropriate.
- A right-side preview panel is acceptable on desktop, but full order detail must also have its own route.

### Customers

Purpose:

- Provide read-mostly customer memory without turning the seller workflow into CRM busywork.

Editable customer fields:

- Name.
- Phone.
- Email.
- Address.
- Notes.

Derived customer fields:

- Customer since.
- Order count.
- Total spent.
- Recent orders.

Required actions:

- Call.
- Text.
- Email.

Remove from the current mockup direction:

- Customer type.
- Preferred payment.
- Default pickup location.
- Customer notification settings.

Recommended customer list fields:

- Name.
- Phone/email.
- City/state if available.
- Order count.
- Total spent.
- Last order date.
- Open orders indicator.
- Contact actions.

Mobile:

- Customer list is card-based.
- Customer detail is a full-screen route.
- Edit contact fields and notes in focused sections.

Desktop:

- Table plus right-side summary is acceptable.
- Full profile route should still exist for deep links and mobile parity.

### Storefront

Purpose:

- Simple V1 public storefront management.

Manage:

- Store name.
- Description.
- Logo.
- Banner.
- Public contact info.
- Pickup instructions.
- Store URL.
- Storefront preview.

Explicitly excluded:

- Page builder.
- Advanced customization.
- Theme designer.
- Marketplace discovery management unless a later group reintroduces it.

Recommended storefront screen structure:

- Publication/status summary.
- Public URL and copy/open actions.
- Store identity: name, description, logo, banner.
- Public contact info: email, phone visibility, website/social links if already supported.
- Pickup instructions.
- Preview panel or preview route link.

Mobile:

- Sections stack.
- Preview opens as a full-screen public storefront preview.

Desktop:

- Main settings column plus preview/status column.
- Preview should use the real public storefront projection where practical.

### Reports

Purpose:

- Provide simple CSV exports only.

V1 reports:

- Sales Report.
- Customer Report.
- Inventory Report.

Explicitly excluded:

- Dashboards.
- Analytics charts.
- In-app report builders.
- Complex visualizations.

Recommended report card fields:

- Report name.
- Short operational description.
- Included fields summary.
- Date range or current snapshot selector where needed.
- Download CSV action.

Report definitions:

- Sales Report: orders, totals, item quantities, payment summaries, selected pickup options.
- Customer Report: customer contact details, customer since, order count, total spent, recent/last order date.
- Inventory Report: listing batches, breeds, inventory rows, quantities, prices, statuses, available dates.

Mobile:

- Reports are stacked action cards.
- Download action remains prominent.

Desktop:

- Reports can remain large simple cards like the mockup, with the missing Inventory Report added.

### Account

Purpose:

- Manage account-level settings and seller defaults.

Keep:

- Security.
- Billing.
- Notifications.
- Seller Defaults.

Remove:

- Usage widgets.
- Integrations section.

Seller defaults include:

- Pickup instructions.
- Pickup location.
- Communication email.
- Order notification email.
- Currency.

Seller defaults should prefill listing creation workflows.

Recommended account sections:

- Business/account identity.
- Security.
- Billing.
- Notifications.
- Seller Defaults.
- Danger zone, if account deactivation remains supported.

Do not mix Storefront V1 design controls deeply into Account. Storefront settings belong under Storefront, while Seller Defaults belong under Account.

## Major Workflows

### Workflow: Seller Creates a Bird Listing

1. Seller taps Create Listing.
2. Seller chooses Birds.
3. Seller chooses Single Breed / Offering or Batch / Mixed Group.
4. UI initializes a draft using seller defaults.
5. Seller enters species, dates, pickup/location fields, and notes.
6. Seller adds one or more inventory rows.
7. Seller enters listing-level pricing/settings and row-level price overrides where applicable.
8. Seller adds listing-level and optional row-level photos if media support is available.
9. Seller reviews the generated listing.
10. Seller publishes or saves as draft.

Backend integration:

- Create final listing through `seller_create_listing_batch_with_inventory(...)`.
- Use `seller_upsert_breed_profile(...)` as needed for seller-owned breed display names.
- Use existing reference data for species and breed selection.
- Draft auto-save likely requires a future persistence decision if no draft table/RPC exists.

### Workflow: Seller Performs a Quick Listing Edit

1. Seller opens listing action menu or quick edit route.
2. Seller changes quantity, price, date, status, visibility, or simple metadata.
3. UI validates locally for obvious field errors.
4. Mutation uses the narrowest existing seller-safe RPC.
5. Seller returns to the previous list/detail context.

Backend integration:

- `seller_update_listing_batch(...)`
- `seller_set_listing_batch_visibility(...)`
- `seller_update_listing_batch_breed(...)`
- `seller_set_listing_batch_breed_visibility(...)`
- `seller_update_inventory_item(...)`
- `seller_adjust_inventory_quantity(...)`
- `seller_set_inventory_visibility(...)`

### Workflow: Seller Manages Pickup Order

1. Seller opens Orders.
2. Seller filters to upcoming pickups or needs action.
3. Seller contacts customer by call, text, or email.
4. Seller opens full order detail.
5. Seller reviews pickup notes and items.
6. Seller marks items/order fulfilled or updates order status where allowed.

Backend integration:

- Read list from `seller_order_management`.
- Read line items from `seller_order_item_detail`.
- Use existing seller order management RPCs for fulfillment/cancellation/status actions.
- Contact actions use device/browser protocols (`tel:`, `sms:`, `mailto:`) and do not require backend mutation unless future logging is added.

### Workflow: Seller Updates Storefront

1. Seller opens Storefront.
2. Seller updates public identity, contact info, pickup instructions, logo/banner, or store URL.
3. UI previews storefront.
4. Seller saves settings.

Backend integration:

- `get_seller_context()` for safe store bootstrap.
- `seller_update_store_settings(store_id, settings)` for whitelisted store fields.
- Public preview can read `get_public_storefront_by_slug(store_slug)` and public storefront projections after settings save.
- Media upload remains deferred by Group 29 and requires future storage/media decisions before real logo/banner upload.

### Workflow: Seller Downloads a CSV Report

1. Seller opens Reports.
2. Seller chooses Sales, Customer, or Inventory Report.
3. Seller optionally selects date range where relevant.
4. Seller downloads CSV.

Backend integration:

- Sales can be derived from `seller_order_management` and `seller_order_item_detail`.
- Customer can be derived from `seller_customer_summary`.
- Inventory can be derived from `seller_inventory_management`.
- If CSV generation is client-side, ensure only authenticated seller-private projections are used.
- If CSV generation is server-side, future API endpoints or Edge Functions should preserve the same RLS/safe projection boundaries.

## API Dependency Mapping

### Bootstrap

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Current seller/store context | `get_seller_context()` | Safe context; omits provider/admin internals. |
| Storefront status summary | `seller_dashboard_home` | Includes storefront enabled/mode/status and operational counts. |

### Dashboard

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Summary cards | `seller_dashboard_home` | Map active listings, pending/open orders, customers via supporting projections where needed. |
| Recent orders | `seller_order_management` | Sort by created date; include pickup fields. |
| Active listings | `seller_inventory_management` | Group by listing batch for dashboard table. |
| Storefront quick link | `seller_dashboard_home`, `get_seller_context()` | Use `store_slug` and public availability fields. |

### Listings

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Listing list | `seller_inventory_management` | Group by batch or breed in UI. |
| Listing create | `seller_create_listing_batch_with_inventory(...)` | Same backend path for single breed and batch workflows. |
| Breed profile create/update | `seller_upsert_breed_profile(...)` | Use for seller-specific display names/custom breeds. |
| Batch edits | `seller_update_listing_batch(...)` | Narrow mutation for batch-level fields. |
| Batch visibility | `seller_set_listing_batch_visibility(...)` | Pause, archive, sold out, active where supported. |
| Breed row edits | `seller_update_listing_batch_breed(...)` | Breed row display/order edits. |
| Breed row visibility | `seller_set_listing_batch_breed_visibility(...)` | Hide/archive breed row where supported. |
| Inventory item edits | `seller_update_inventory_item(...)` | Type, label, price override, sort, notes. |
| Quantity edits | `seller_adjust_inventory_quantity(...)` | Use for operational quantity changes. |
| Inventory visibility | `seller_set_inventory_visibility(...)` | Hide/archive inventory rows. |
| Photos | Future media API | Group 29 defers upload/storage policy decisions. |
| Drafts | Future draft persistence decision | Required by Group 31; not clearly covered by current backend. |

### Orders

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Order list | `seller_order_management` | Includes customer snapshots, status, totals, pickup notes, item counts. |
| Order item detail | `seller_order_item_detail` | Use for full order detail and fulfillment. |
| Refund summary | `seller_refund_summary` | Secondary V1 visibility only if needed. |
| Notification summary | `seller_notification_summary` | Operational troubleshooting if notifications fail. |
| Fulfillment/status mutations | Existing Group 12 seller order RPCs | Use existing trusted RPCs; do not mutate order tables directly. |
| Customer contact | Snapshot fields from `seller_order_management` | Call/Text/Email are front-end protocol actions. |

### Customers

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Customer list | `seller_customer_summary` | Read-mostly operational contact list. |
| Derived stats | `seller_customer_summary` | Order count, open orders, lifetime total, latest order date. |
| Recent orders | `seller_order_management` filtered by customer | Needed for detail page. |
| Edit customer fields | Future safe customer update RPC | Group 31 requires editing name, phone, email, address, notes. Current safe wrapper should be confirmed before UI implementation. |

### Storefront

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Store settings read | `get_seller_context()` and store-safe projections | Use seller-safe data only. |
| Store settings update | `seller_update_store_settings(store_id, settings)` | Whitelisted updates only. |
| Public preview | `get_public_storefront_by_slug(store_slug)`, `public_storefront_home`, `public_storefront_inventory` | Preview should match buyer-safe public output. |
| Logo/banner | Future media API | Upload and media linking deferred. |

### Reports

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Sales CSV | `seller_order_management`, `seller_order_item_detail` | Client or future server export. |
| Customer CSV | `seller_customer_summary` | Include only seller-private allowed fields. |
| Inventory CSV | `seller_inventory_management` | Include batch, breed, inventory, quantity, price, status. |

### Account

| UI Need | Existing API Boundary | Notes |
| --- | --- | --- |
| Seller defaults | `get_seller_context()`, `seller_update_store_settings(...)` if fields are whitelisted | Confirm exact fields before implementation. |
| Billing | Existing billing status context | UI must not expose provider IDs. |
| Security | Auth provider/session APIs | Keep separate from store settings. |
| Notifications | Existing notification settings/status if present | Distinguish seller defaults from notification delivery status. |

## State Management Requirements

Recommended state categories:

- Server state: seller context, dashboard projections, listings, orders, customers, storefront settings.
- Form state: create listing, edit listing, customer edit, storefront settings, account defaults.
- Draft state: listing creation draft with auto-save and resume.
- UI state: filters, sort, selected view, selected rows, pagination, active section.

Server state:

- Use a consistent query/cache layer once implementation begins.
- Scope all seller queries by authenticated user/store context.
- Invalidate affected projections after mutations.
- Avoid storing derived server totals only in client state when projections can provide them.

Create listing draft state:

- Must support mobile interruption.
- Should autosave per step or per meaningful field group.
- Should record selected workflow path while preserving the common backend payload model.
- Should distinguish local unsaved changes from saved draft state.
- Should handle offline/poor connection gracefully if practical.

Filter and view state:

- Listings view toggle should persist per user/device.
- Orders filters should preserve return context after viewing details.
- Customer search/filter state should preserve return context after editing a customer.

Mutation state:

- Quick edits need optimistic or near-immediate feedback.
- Quantity and visibility changes should show clear error recovery if server validation rejects the change.
- Avoid trusting client-calculated price, quantity, ownership, or totals.

## Component Hierarchy Recommendations

These are conceptual boundaries only, not implementation code.

Seller shell:

- SellerAppShell
- SellerNavigation
- SellerMobileNavigation
- SellerPageHeader
- SellerPrimaryAction
- StoreIdentitySwitcher
- NotificationIndicator

Dashboard:

- DashboardSummaryGrid
- DashboardMetricCard
- StorefrontQuickLinkCard
- RecentOrdersList
- ActiveListingsList

Listings:

- ListingsToolbar
- ListingsViewToggle
- ListingBatchTable
- ListingBatchCardList
- BreedGroupedListings
- ListingActionMenu
- ListingStatusBadge
- InventoryAvailabilityMeter

Create listing:

- CreateListingStart
- ListingWorkflowSelector
- ListingDraftStatus
- ListingStepProgress
- BirdListingBasicsStep
- InventoryRowsStep
- PricingSettingsStep
- ListingPhotosStep
- ListingReviewStep
- ListingPublishActions

Edit listing:

- ListingEditHeader
- ListingQuickEditPanel
- ListingBatchInfoSection
- InventoryRowsEditor
- PricingSettingsSection
- ListingMediaSection
- ListingSummaryPanel
- ListingDangerActions

Orders:

- OrdersToolbar
- OrdersStatusTabs
- OrdersTable
- OrderCardList
- OrderContactActions
- OrderDetailHeader
- OrderCustomerCard
- OrderItemsTable
- OrderFulfillmentActions
- PickupDetailsSection

Customers:

- CustomersToolbar
- CustomersTable
- CustomerCardList
- CustomerContactActions
- CustomerDetailHeader
- CustomerEditableContactSection
- CustomerNotesSection
- CustomerDerivedStats
- CustomerRecentOrders

Storefront:

- StorefrontStatusCard
- StorefrontUrlCard
- StorefrontIdentityForm
- StorefrontMediaSection
- PublicContactForm
- PickupInstructionsForm
- StorefrontPreviewPanel

Reports:

- ReportsList
- ReportDownloadCard
- ReportDateRangeControl

Account:

- AccountSecuritySection
- BillingSection
- NotificationsSection
- SellerDefaultsSection
- AccountDangerZone

Shared:

- EmptyState
- ErrorState
- LoadingState
- StatusBadge
- ContactActionButton
- ExportButton
- SaveBar
- ConfirmActionDialog
- FullScreenMobileDetailLayout

## Desktop Behavior

Desktop should optimize for scanning and operational throughput:

- Persistent sidebar navigation.
- Tables for dense lists.
- Inline row actions where safe.
- Right-side context panels for selected orders, customers, and listings.
- Full detail routes remain available for deep links, mobile parity, and complex edits.
- Create Listing may use a centered workflow, but should still preserve the mobile-first step model.
- Bulk actions may exist for orders and listings when they save time, but V1 should keep them secondary.

Desktop tables should not copy the mockups blindly when requirements remove fields. For example, Customers should not include customer type, preferred payment, or default settings.

## Mobile Behavior

Mobile is a first-class seller workflow:

- Use full-screen detail pages.
- Do not use slide-over drawers as the primary mobile workflow.
- Use cards instead of tables for listings, orders, and customers.
- Put contact actions near the top of order and customer cards/details.
- Make Save Draft and Continue actions persistent during listing creation.
- Ensure each seller task can be completed one-handed where practical.
- Keep common actions one tap away: call, text, email, create listing, save draft, publish, mark fulfilled.

Mobile routes should preserve return context:

- Back from order detail returns to the same order filter.
- Back from listing edit returns to the same listing view and filter.
- Back from customer edit returns to the same search/filter state.

## Future Extensibility Considerations

Listing model:

- Equipment & Supplies is intentionally introduced as a top-level seller choice, but its field model is not defined in Group 31.
- Single Breed / Offering and Batch / Mixed Group must continue to share backend architecture.
- Future livestock species should use the same listing batch, breed/profile, and inventory row concepts where possible.

Media:

- Listing-level and inventory-row photos are required in UI direction.
- Real upload support depends on the deferred media group deciding storage bucket, object path convention, MIME/file limits, image processing, moderation, and `media_links` validation.

Drafts:

- Draft auto-save is required.
- A future implementation decision is needed for persistent drafts: local-only recovery, server-side draft records, or mapping draft listings onto existing visibility/status fields.

Reports:

- V1 is CSV-only.
- Future report dashboards and charts should be additive, not prerequisites for export.

Storefront:

- V1 avoids page builders and advanced customization.
- Future customization should remain structured settings, not freeform page construction, unless the product direction changes.

Orders:

- Payment workflows should not dominate the seller UI.
- Future Stripe/card features must still preserve pickup operations as the core order management workflow.

Customers:

- Customer management should stay operational and read-mostly.
- Avoid adding CRM-style fields unless they clearly save seller time.

Multi-store:

- The shell can reserve space for a store identity switcher.
- Do not assume multi-store workflows unless backend and product requirements confirm them.

## Open Questions for Future Decisions

- What is the persistent draft architecture for listing creation?
- Which fields, if any, represent equipment and supplies in V1?
- Are seller customer edits currently covered by a safe RPC, or does a future wrapper need to be added?
- Which exact store fields are whitelisted by `seller_update_store_settings(...)`, and do they cover all Storefront and Seller Defaults fields?
- What is the final media upload architecture for logo, banner, listing photos, and inventory-row photos?
- Should reports be generated client-side from seller projections or server-side through export endpoints/Edge Functions?
- Group 32A decision: V1 pickup workflow uses seller-defined pickup options/dropdown choices, not arbitrary scheduled pickup dates.
- Group 32A decision: "Upcoming Pickups" means open orders with selected pickup options, not reserved inventory or future availability.
- What notification preferences exist today versus what should be deferred?
- Should listing duplication copy photos when media support exists?
- Should archived listings remain searchable by default, or require an archive filter?
- What is the canonical status vocabulary shown to sellers for listing, order, payment, and fulfillment states?
- Should public Storefront preview read only saved production data, or support unsaved preview state during editing?
- Is Account billing V1 read-only with a billing portal link, or editable inside the seller dashboard?

## Implementation Guardrails for Later Groups

- Do not bypass seller-safe RPCs for mutations.
- Do not expose provider IDs, admin fields, audit internals, or private seller notes in public storefront UI.
- Do not introduce new schema for Group 31; this document is only foundation planning.
- Do not turn the seller dashboard into a generic ecommerce admin panel.
- Do not require sellers to understand backend concepts such as batches, breed rows, and inventory item IDs. Use seller-friendly labels while preserving the existing architecture under the hood.
