# Enterprise Chick Module — Architecture Assessment and Final Phased Plan

September 28, 2026. Planning only; no application changes, database migrations, payment operations, or data imports are performed. Product authority: [consolidated approved requirements](enterprise-chick-module-requirements.md).

## Assessment and changes from the earlier review

FlockFront supplies reusable store/customer/order identities, server-side pricing boundaries, order/item snapshots, statuses, pickup options, manual-order services, printing, notification delivery, Stripe Connect immediate payments, cancellation/refund safeguards, and archive behavior. Enterprise adds a specialized future-hatch inventory and operational flow; it must not change ordinary live-bird inventory semantics.

Final clarifications change the previous assessment as follows:

| Topic | Final requirement | Architectural effect |
| --- | --- | --- |
| Late wholesale card orders | Charge immediately when submitted less than seven days before hatch | Scheduled-payment path must branch to immediate payment when already inside the charging window |
| Paid reductions | Automatically refund the difference before the editing cutoff | Paid editing requires partial refunds; existing full-cancellation-only orchestration is insufficient |
| Coupon usage | Consume on successful order creation; release on cancellation; same-coupon edits consume no extra use | Transactional, order-bound usage records with idempotent consume/release, not an unreliable counter alone |
| Cutoff | Store local midnight, seven calendar days before hatch | Store timezone plus local date arithmetic; never browser timezone or a fixed 168-hour subtraction |
| Transport minimums | No retail or wholesale chick minimum enforcement | Explicit transport exemption before ordinary minimum validation; no automated transport-volume rule |
| Deletion | No true deletion; existing cancel/archive and retained history | Remove deletion work and destructive dependency rewrites; retain cancellation/refund/restoration integration |
| Reporting | Hatch date is the reporting date | Chick reports and migration must retain reliable hatch associations; do not group chick sales by creation/payment date |

The earlier true-deletion conflict is resolved by the new requirement. Historical duplicate numbering remains a separate migration conflict.

## Proposed data-model changes

These are recommended implementation structures, not executed schema changes. Exact names and physical layout should be finalized against the deployed database and unresolved questions before implementation.

### Shared FlockFront changes

- **Store configuration/capabilities:** Add an explicit Enterprise chick capability and validated IANA store timezone. Preserve existing plan identities and feature behavior. Do not infer Enterprise subscription prices. Decide whether timezone changes can affect existing future orders before exposing changes.
- **Buyer identity/access:** Add authenticated buyer-to-customer associations, verification/linking provenance, and narrowly scoped buyer permissions. Preserve store-scoped customer contact records. Wholesale approval needs staff approval metadata; confirm its tenant scope. Optional store-staff membership/permissions are needed if separate staff logins are required; current owner/admin checks are not a staff-role system.
- **Orders:** Keep shared UUID identity, store/customer links, existing statuses, numbering, payment state, archive flags, and historical buyer snapshots. Add an explicit module/order-kind discriminator so carts, staff filters, reports, and notifications can distinguish chicks without making a new chick status model.
- **Order items:** Add a recognized chick source and server-produced breed/sex, quantity, unit-price, and discount snapshots. Extend source validation, same-store relationships, seller/buyer projections, totals, fulfillment, print loaders, and action predicates. Do not hide chick items as generic custom lines that lack inventory authority.
- **Pricing/totals:** Retain purchased prices and separately record the provenance/effects of retail/wholesale mode, hatch discount, coupon, staff unit overrides, and order adjustments. Preserve final totals and rounding consistently. Do not silently treat every adjustment as the existing distributed line discount.
- **Shared coupons:** Add coupon definitions and restriction targets plus order-bound redemption records. Retaining one coupon through edits keeps the same use; cancellation releases it exactly once. Validate limits atomically under concurrent creation. Hatch constraints extend the shared engine rather than making coupons unusable by standard FlockFront later.
- **Buyer management links:** Add secure, expiring/revocable guest management credentials with hashed storage, scoped authorization, and protected redemption. Tokens must not substitute for unrestricted customer access or be exposed through staff/customer public projections.
- **Payments/refunds:** Extend payment bindings for saved-card/off-session PaymentIntents; existing refund paths expect Checkout Session bindings and cannot be assumed to cover every scheduled charge. Track due time, payment attempts, idempotency, provider account/test-live context, partial-refund requests/results, and recovery state. Store Stripe references, never raw card details.
- **Audit/notifications:** Extend existing order/inventory/payment events and notification types to represent chick allocations, edit/refund outcomes, transport context, and scheduled-charge failure. Preserve existing queues, retries, provider truth, and privacy boundaries.
- **Migration provenance:** Retain source system, Wix identifiers, original order number/date, and reconciliation outcomes. Ensure detailed imports and existing customer historical aggregates do not double-count spend or orders.

### Enterprise chick structures

- **Hatch calendar:** Store-scoped hatch identity and local hatch date; operational ordering controls; associations used by transport, availability, counts, orders, reports, and charging. Customer editability remains derived rather than a stored order status.
- **Breed/sex offerings and prices:** Reuse seller breed profiles where identities match. Add chick retail/wholesale prices, offering eligibility, operational layer/meat/choice classification, and a stable hatch/order reference. Hatchery Choice may need explicit operational identity rather than being assumed to be an ordinary catalog breed.
- **Hatch availability:** Hatch/breed/sex quantities, manual changes/import provenance, and auditable allocation. Use fractional-capable allocation or equivalent scaled units for half-pullet fallback; ordered chick quantities remain whole numbers.
- **Allocation records:** Persist the inventory source and actual amount consumed per line. Cockerels consume zero; SR uses direct SR availability or the established half-pullet fallback. Release against the recorded original source, not whichever source happens to exist later. Check and reserve combined F/SR demand atomically.
- **Hatch counts:** Actual counts keyed to hatch and eligible operational breed/sex, separate from available-to-sell quantities. Do not silently overwrite availability when counts are entered unless a workflow rule explicitly authorizes it.
- **Hatch discounts:** Retail percentage and enable/disable state, with purchase-time snapshots; wholesale remains unaffected.
- **Transport:** Store/hatch-bound code, staff-managed fulfillment details, and order associations. No chick-minimum or transport-capacity enforcement. Keep transport grouping identity stable for weekly printing.
- **Chick order details:** Hatch, pricing mode/provenance, transport or pickup choice, packaging, and operational notes. A one-to-one companion to shared orders is the recommended starting point; exact placement of fields should be settled during schema design.
- **Pickup association:** Reuse existing repeatable store pickup labels and snapshots. Add hatch relationship/context; only add structured date/time fields if confirmed necessary. No capacity model.
- **Import staging:** Availability/production-planning imports and historical migration need validation/mapping/reconciliation stages before committing authoritative records. Historical imports must not decrement current availability, charge cards, send confirmations, or consume present-day coupon uses automatically.

## Existing services to reuse and boundaries to extend

| Existing foundation | Reuse | Extension / restriction |
| --- | --- | --- |
| Store ownership, RLS, trusted RPCs | Tenant isolation and server mutations | Buyer/staff permissions and Enterprise capability; never authorize from browser flags |
| Customer matching | Normalized name plus contact, same-store matching | Linking requires ownership evidence; contact match alone cannot expose history |
| Shared orders/items/statuses | UUIDs, numbering, snapshots, status and fulfillment | Explicit chick source/module; broaden authorized paid editing without weakening ordinary inventory checks |
| Pickup options | Repeatable labels, descriptions, archived historical snapshots | Hatch context and editable buyer selection; no pickup for transport |
| Inventory reconciler | Locking, exact-delta/idempotency principles, activity tracking | New hatch allocation path; integer listing debit ledger is not the fractional chick allocator |
| Manual order services | Customer search, quantity/unit editing, notes, optional email | Mirror Whiting staff form, not the standard inventory-browser experience |
| Stripe Connect | Seller payment account, verified events, direct-charge boundaries | Saved cards, scheduled/immediate late wholesale payment, partial refunds and generalized payment bindings |
| Cancellation/refund logic | Provider proof, duplicate protection, recovery, payment history | Eligible buyer actions and chick allocation/coupon releases; existing partial-refund preflight must recognize system-created reduction refunds safely |
| Archive | Organizational flag with history retained | No cancellation, inventory release, coupon release, refund, or charge suppression solely because archived |
| Email queue/Postmark worker | Delivery, retries, idempotent action notifications | Whiting content, buyer links, payment failure, differentiated weekly reminders |
| Print/export utilities | Safe order loading and downloads | Dedicated weekly hatch matrix and transport grouping, nine-column packet behavior |
| Customer summary/history | Shared customer order association | Chick-inclusive history, buyer-safe projections, imported aggregate reconciliation |

Evidence in the repository includes `lib/plan-capabilities.ts`, the standard `storefront-cart-client.ts`, `conservative_order_customer_identity`, `unified_order_inventory_reconciliation`, `order-action-predicates.ts`, `stripe-connect-checkout`, Stripe paid-cancellation migrations/functions, `order_archive_actions`, pickup-options migrations, and `customer_imported_history`.

Architecture documents predate some later Stripe Connect/temporary-hold implementation. Current migrations, handlers, and tests take precedence over stale architectural descriptions. Repository inspection is not proof that every migration is deployed.

## Recommended implementation sequence and acceptance gates

### Phase 0 — Contracts, deployed-state check, and parity fixtures

**Work:** Confirm deployed schema/Stripe capabilities; freeze the approved requirement version; resolve affected open questions; catalog Whiting buyer/staff/weekly-sheet acceptance fixtures. Inventory source, price, refund, date, coupon, and permission cases must be explicit.

**Dependencies:** Extracted Whiting iframe and bridge evidence; CMS export inventory; no historical imports yet. Any missing old source matters only where approved parity cannot otherwise be established.

**Acceptance:** Requirement-to-test coverage exists; no true-delete/BOGO/separation-fee work; standard storefront/cart/payment behavior has a regression baseline. Establish example cutoff: October 20 hatch closes self-service October 13 at 00:00 store local.

### Phase 1 — Shared identity, module boundaries, and hatch data

**Data/model:** Enterprise capability; timezone; buyer linking/access; wholesale approval; chick order/source classification; hatch calendar; offering classifications; breed/sex prices; transport; pickup associations; migration provenance.

**Reuse/add:** Reuse Supabase authentication, store ownership, breed profiles, customer contacts, pickup options and shared orders. Add buyer access surfaces and Enterprise management foundations. Implement staff membership only to the confirmed extent.

**Dependencies:** Confirm account-linking security and approval scope. Inspect existing Whiting imported customer totals so source identities map consistently.

**Acceptance:** Cross-store access fails; wholesale approval is enforced server-side; guest links cannot enumerate history; chick/live-bird carts and module identities are isolated; unrecognized Enterprise capability cannot silently fall back to a standard plan.

### Phase 2 — Allocation, pricing, coupons, and hatch operations

**Data/model:** Hatch availability and allocation records; actual hatch counts; retail hatch discounts; pricing/adjustment provenance; shared coupon definitions/redemptions; import staging.

**Reuse/add:** Reuse transactional server mutation/locking patterns; add Enterprise availability, hatch-count, price, transport and hatch administration. Implement trusted order pricing and minimum validation, including transport exemption.

**Dependencies:** Breed/sex mappings and source availability records reconciled; coupon semantics for changing/removing a coupon confirmed where needed. Finalize date arithmetic and rounding.

**Acceptance:** Concurrent combined F/SR purchases cannot oversell; cockerels debit zero; odd SR quantities allocate correctly; reduction/cancel reverses the original allocation exactly once. Retail 25 and wholesale 50/5 apply to non-transport; transport orders can be below either minimum. Coupons stack with retail hatch discounts, never accept browser totals, consume at successful creation, and do not double-consume on retries/same-coupon edits. Hatch counts select F layers/SR meat and exclude Choice.

### Phase 3 — Payment lifecycle and paid editing services

**Data/model:** Saved Stripe references, due/attempt state, connected-account bindings, partial-refund/recovery records, and related audit/notification events. No new chick order-status system.

**Reuse/add:** Reuse Connect immediate payments and provider proof/idempotency. Add scheduled charging worker, late-wholesale immediate path, automatic reduction refunds, buyer cancellation orchestration, payment-failure notices, and secure recovery.

**Dependencies:** Phases 1–2 order/allocation/pricing contracts; test Stripe account; remaining staff-paid-edit and refund recalculation decisions. Confirm charge time on the seven-day local date. Do not copy platform subscription-billing jobs as customer sale authority.

**Acceptance:** Retail card charges immediately; wholesale future card orders reserve chicks and charge when due; wholesale late card orders charge at submission; transport cannot use pickup payment. Failed scheduled payment retains order/stock and alerts buyer/staff. Retry/webhook races never charge/refund twice. Paid eligible reductions refund the server-calculated difference; later full cancellation refunds only the remaining refundable balance. Fulfillment, canceled quantities, physical restoration and financial refunds remain distinct. Test interruptions between Stripe success and database reconciliation.

### Phase 4 — Whiting staff and buyer flows, embed, and communication

**Data/model:** Final chick operational detail/packaging fields, buyer-link lifecycle, and email payload snapshots.

**Reuse/add:** Build Whiting-parity staff Add/Edit and hatch-first buyer interfaces; dedicated chick cart/checkout/embed; buyer current/history/manage pages; customer search/autofill; print-after-save; optional staff-send; automatic customer-update emails. Use existing statuses and cancel/archive actions, not true deletion.

**Dependencies:** Trusted services and payments completed first; buyer integration can proceed in parallel once their contracts stabilize. Weekly reminder trigger/content decisions confirmed.

**Acceptance:** Hatch/breed/sex/quantity interaction matches approved Whiting fixtures. Local-midnight cutoff is enforced by server at the exact boundary, including DST and buyers in other zones. New ordering remains open through the previous local day. Paid additions require another order. Mode/transport survives edits. Cancel releases coupon once; archive changes none of stock, coupon use, financial state, or scheduled payment eligibility. Transport messages contain no hatchery pickup instructions. Account/guest links reach the correct authorized management flow. Test actual third-party iframe authentication/navigation, not only a hosted preview.

### Phase 5 — Weekly sheet and operational reports

**Data/model:** Hatch-centered reporting projections/indexes; no new dashboard product.

**Reuse/add:** Extend print/export plumbing for the Whiting matrix, grouped transport columns, totals, packet printing, YTD chick sales and hatch-count export.

**Dependencies:** Stable order/transport/packaging/quantity data; agreed report inclusion/refund treatment. Historical rows need hatch dates before joining these reports.

**Acceptance:** Staff verifies visual/content parity for pickup-only, mixed transport, shared transport, and multiple nine-column batches. Contacts, order numbers, pickup, packaging, breed/sex and totals match source orders. YTD uses hatch year even when order/payment falls in another year. Archiving does not erase financial history; inclusion of canceled/refunded orders follows the confirmed report definition. No automatic switch to order-created dates for missing hatch data.

### Phase 6 — Migration rehearsals and controlled cutover

**Data/model:** Reconciliation staging, legacy-to-FlockFront ID mappings, original numeric identifiers, historical hatch/transport/pricing/adjustment/coupon references. Archive/cancel records retain payment/audit history.

**Reuse/add:** Reuse shared customer/order/item identities and source snapshots; create a validated chick importer only after destination contracts are stable. Reuse existing imported aggregates only after reconciliation.

**Dependencies:** Legacy customers/headers/items relationships, duplicate numbering policy, missing-header decisions, hatch/breed/transport mapping, availability anomaly resolution, coupon history quality, and aggregate double-count prevention. Existing Wix Stores/adult history remains outside this importer.

**Acceptance:** Repeatable dry runs produce source/destination counts and totals, line/header reconciliation, original-price checks, no orphan associations, and an exception report. Imported historical orders do not mutate present stock, send emails, schedule charges or consume live coupon limits. Existing imported customer spend/count is reconciled exactly once. Outstanding operational orders require a separately verified current balance/reservation/payment classification; do not charge historical saved-card assumptions. A final operational snapshot and writes freeze/delta procedure prevent lost orders during handover. Staff signs off; recovery/rollback rehearsal and standard-storefront regression pass before launch.

## Cross-phase test requirements

- Tenant isolation, buyer identity/link authorization, token expiration/revocation and staff roles.
- Independent chick/standard cart storage, checkout, embed returns and account login.
- Calendar cutoff and sales closing boundaries in store timezone, DST, exact boundary and late wholesale orders.
- Atomic allocation/reservation/release, SR source changes, odd quantities, shared F/SR demand and manual adjustments.
- Retail/wholesale pricing authority, transport exemption, staff overrides, discounted snapshots and cents rounding.
- Coupon concurrent last-use creation, idempotent success/release, same-coupon edits and cancellation after edit.
- Immediate versus scheduled payment, failed charge retention, refunds, duplicates, recovery and payment-provider account binding.
- Staff/customer edit distinctions, no paid additions, cancel versus archive, audit preservation.
- Nine-column weekly packets, transport batching, hatch-based reports and missing-hatch exceptions.
- Migration idempotency, duplicate numbers, missing relationships, source prices and imported-history reconciliation.

## Remaining implementation questions

The seven final clarifications are settled and must not be reopened as blockers. These details still need answers before the affected work:

1. What evidence authorizes linking historical guest orders to a verified account when email/contacts are shared? Is wholesale approval store-specific?
2. For non-transport retail customers granted wholesale prices, which minimum applies? Does coupon eligibility follow retail customer type or retail pricing mode? Transport minimum exemption itself is settled.
3. Are pickup windows labels only in V1, or structured local time/date information? What exact local time should the automatic charge run on the seven-day date? Midnight edit cutoff is settled.
4. What operational breed classifications and staff oversell policy should be authoritative? How should the direct-SR-versus-fallback rule treat a present SR row with zero stock? Do not silently switch sources to bypass exhausted availability.
5. How do refunds/repricing interact with coupon thresholds/restrictions, hatch changes, staff overrides and rounding? If an edit changes/removes/adds a coupon, how do redemption and eligibility behave? Same-coupon usage, cancellation release, and automatic paid-reduction refunds are settled.
6. What financial intervention is allowed for staff changes to paid orders, including additions, transport changes or moving the hatch? How are scheduled charges rescheduled after a hatch change, and are failed charges automatically retried or handled by staff? Failed orders retaining stock is settled.
7. Are weekly reminders staff-triggered batches or scheduled sends? Which separate staff logins/permissions are needed?
8. Which order states and gross/net amounts count in YTD? Hatch date is settled as the reporting date. How should missing historical hatch dates, duplicate numbers and missing log/header records be reconciled, and which already-imported customer aggregates include chick purchases?

## Verification performed for this planning update

Read-only checks confirmed the existing archive contract: it is organizational and must not change inventory, cancellation, totals, Stripe state or emails. Existing canceled item quantity is distinct from physical inventory restoration. No store timezone setting or operational wholesale/coupon engine was found in the searched current code/migrations; webinar timezone fields are not store timezone support.

The preceding assessment ran 39 targeted repository tests successfully. No deployed database, live payment action, migration, application build, or new Enterprise behavior was verified in this documentation-only update.
