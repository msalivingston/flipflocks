# FlockFront Enterprise Chick Module — Approved Requirements

Consolidated September 28, 2026. The user's final clarifications supersede earlier conflicting requirements and the earlier architecture assessment. This document records product decisions, not implementation. All unclarified behavior remains subject to explicit confirmation rather than assumption.

## 1. Purpose and scope

The Enterprise Chick Module serves hatcheries and larger poultry sellers with scheduled hatches, future availability, wholesale customers, transport, pickup windows, hatch counts, and staff fulfillment. Whiting Farms is the first implementation.

It is a specialized Enterprise module, not a replacement for standard FlockFront selling. Small sellers can continue listing chicks through the standard inventory/storefront.

Enterprise chick ordering and started/adult bird ordering have separate storefront/embed experiences, carts, and checkouts. Messaging must explain the distinction and their different pickup schedules.

## 2. Customer types and accounts

There are two business customer types: Retail and Wholesale. Wholesale status requires staff approval.

Retail customers may order as guests or optionally use a FlockFront customer account. They see retail pricing and have a 25-chick total minimum, except transported orders. Logged-in retail customers manage eligible orders through their account; guests receive a secure management link.

Wholesale customers must authenticate, preferably using email/password through the existing Supabase foundation. They always receive wholesale pricing, without a pricing-mode choice. They have a 50-chick total minimum and a 5-chick minimum per breed, except transported orders. Their accounts provide current/historical orders and eligible editing.

Staff may grant wholesale pricing to a retail customer/order. There is no customer-specific negotiated pricing in V1. Review and reuse existing customer matching/account infrastructure where appropriate; do not unnecessarily redesign it.

## 3. Transport customers

Customers select transport during ordering; staff may assign, change, or remove it. Each transport code belongs to a specific hatch date. A valid selection associates the order with both transport and hatch and applies wholesale pricing.

Transport orders require card payment and do not select hatchery pickup windows. Retail and wholesale chick minimums do not apply to transport orders. Transport-level minimum/volume requirements are handled operationally by staff, not enforced by FlockFront.

Shared transport orders must remain groupable for fulfillment, weekly columns, batches, and printing. Wholesale pricing does not, by itself, redefine the customer's business type or card-payment timing.

## 4. Pickup

Non-transport customers select a pickup window. Windows may repeat across hatches, require no capacity limits, and may include location in the title. Customers may change pickup while editable; staff may change it at any time. Reuse existing pickup logic where appropriate. No complicated capacity system is required.

## 5. Hatch dates

Staff creates hatch dates manually and/or imports them from production planning. Ordering is hatch-driven and starts from the existing Whiting buyer flow unless an explicit requirement overrides it.

New orders remain available until the day before hatch if availability remains. The seven-day cutoff limits existing-order self-edit/cancellation, not new sales. Date rules use the hatchery/store local timezone.

## 6. Chick availability

Maintain availability by hatch, breed, and sex/business allocation logic. Support spreadsheet initialization and manual adjustment; copying/seeding prior hatch information is a potential initialization capability whose exact interface remains an implementation/workflow question.

Order placement immediately reduces availability; eligible reductions immediately release it. Staff may sell/adjust after customer editing closes. Buyers see exact quantities.

Preserve existing allocation behavior: cockerel lines do not reduce availability; straight-run uses its own availability when it exists; otherwise use the existing pullet fallback, consuming half the straight-run quantity from pullet availability. Preserve the business behavior, not the Wix implementation artifacts.

## 7. Hatch counts

Staff records actual counts after hatch. Record pullets for layer breeds and straight-run for meat birds; exclude Hatchery Choice. Preserve the operational purpose and row-selection rules.

## 8. Ordering flow

Use the existing Whiting hatch selection, breed/sex selection, quantity interaction, and order-building flow as the V1 starting point. Change only where required by approved rules or known defects. Rules that Wix merely displayed must be enforced.

## 9. Minimums

For non-transport orders, enforce 25 chicks total for retail and 50 total plus 5 per breed for wholesale. Staff may override minimums. Transport orders are exempt from all these chick minimums; transport-volume decisions remain with staff outside enforcement.

## 10. Pricing

Each breed/sex has standard retail and wholesale prices. No automatic quantity tiers beyond these modes are required. Server-side pricing is authoritative; buyers cannot supply arbitrary final prices. Staff may override unit prices and select pricing where appropriate.

## 11. Hatch-level discounts

Staff can enable/disable and set a percentage retail discount for an entire hatch. Wholesale is unaffected. Buyers see the resulting retail price automatically; the purchased price is preserved. Hatch discounts stack with coupons and remain distinct from coupons and manual overrides.

## 12. Coupons and promotions

Support retail-only coupons that stack with hatch discounts. No BOGO in V1. Support percentage, fixed order amount, fixed per-chick amount, active dates, minimum subtotal, customer/email restrictions, breed restrictions, hatch restrictions, and usage limits.

Consume one coupon use when an order is successfully created. Release that use if the order is canceled. Editing while retaining the same coupon does not consume another use. Count and enforce usage correctly. Coupon support should eventually serve standard FlockFront too.

## 13. Manual staff adjustments

Retain manual unit-price overrides, order adjustments, retail/wholesale selection, minimum overrides, quantities, hatch changes, transport, pickup, customer information, notes, and packaging/fulfillment details. Mirror the proven Wix workflow unless a known defect requires a change. Cancellation/archive replaces Wix deletion.

## 14. Customer editing and cancellation

Both customer types may self-edit and self-cancel until midnight seven calendar days before hatch, in the hatchery/store local timezone. The boundary is the start of that local calendar date, not a rolling 168-hour interval. Example: an October 20 hatch closes self-service at October 13, 00:00 local time.

At the boundary, self-edit and self-cancellation close; staff remains able to intervene beyond the cutoff, and new sales remain open until the day before hatch if availability remains.

Eligible reductions release inventory immediately. For a paid eligible reduction, automatically refund the difference. A paid card order canceled before the cutoff receives an automatic refund. No V1 cancellation fee.

## 15. Payment

Payment choices are card in advance or pay at pickup; there is no generic deferred-card "pay later" choice.

Retail card orders charge immediately. Retail pay-at-pickup needs no card. Wholesale card orders securely save the payment method through Stripe and charge seven days before hatch. Wholesale card orders submitted less than seven days before hatch charge immediately on submission. Wholesale pay-at-pickup makes no card charge.

Transport requires card and cannot use pay at pickup. Apply card timing according to customer type, including the late-wholesale immediate-charge rule; transport wholesale pricing alone is not a new customer type.

Failed automatic wholesale charging must not cancel the order or release chicks. Mark it unpaid/payment failed, notify the customer automatically, and make the failure obvious to staff. Staff determines subsequent action.

## 16. Paid-order additions

Customers cannot add chicks to an already-paid order through incremental charges in V1; they place another order. Staff may manually intervene. Eligible paid reductions remain supported with automatic difference refunds.

## 17. Order status

Use existing FlockFront order statuses for pickup and transport. Staff updates statuses manually. Derive customer editability from hatch date/timezone/cutoff, not a new status. Only propose another status model if a concrete technical necessity is identified and discussed.

## 18. Chick versus live-bird storefront

Keep separate shopping paths, carts, and checkout. Explain that chicks reserve upcoming hatches and started/adult birds use existing inventory with different pickup schedules. Clearly identify the active cart/order experience. No combined cart in V1.

## 19. Embeds

Provide a dedicated Enterprise chick embed so a hatchery can place it on a separate website page without complicating the standard FlockFront embed.

## 20. Confirmations and communication

New confirmations use essentially the current Whiting order-summary content. Customer edits automatically send updated confirmations. Staff updates offer an explicit optional send control.

Continue weekly pickup reminders with pickup-specific instructions; transport orders receive appropriate transport content, not hatchery pickup instructions. Include relevant payment status/instructions.

Account customers, retail or wholesale, are directed to their accounts. Retail guests receive secure management links.

## 21. Weekly staff sheet

Reproduce the critical hatch-centered weekly sheet essentially as-is: individual customer columns, grouped transport columns, customer/business names, contact details, order number, pickup time, packaging, breed/sex quantities, totals, batching, and weekly packet printing.

Preserve batches of up to nine columns. Improvements for larger layouts may wait until after staff uses V1.

## 22. Staff Add/Edit Order

Mirror customer search/autofill, pricing selection, hatch/transport selection, manual quantities/unit prices/adjustments, customer-facing notes, pickup, packaging, order search/edit, print-after-save, and optional updated confirmation.

Replace the old deletion capability with existing FlockFront cancellation/archive behavior. Do not implement true deletion. No substantial workflow redesign otherwise.

## 23. Cancellation and archive — supersedes true deletion

Do not implement true order deletion. Use existing FlockFront archive/cancel behavior and preserve payment/audit history. Cancellation performs applicable inventory, coupon, and refund changes. Archive is organizational only; archiving does not itself cancel, release inventory/coupon usage, or refund an order.

## 24. Reporting and admin

Provide customer search/history, order search, YTD chick sales, hatch-count export, weekly order/production summary, breed management, retail/wholesale price management, coupons, transport, hatch dates, and availability administration.

YTD chick sales and related operational reporting use hatch date as their reporting date, not order-creation or payment date. No new analytics dashboard is specified.

## 25. Customer history

Ultimately present unified chick and adult/live-bird purchase history where identity is appropriately matched. Keep separate ordering flows. Review existing guest/customer/account linking before proposing changes.

## 26. Historical migration

Eventually migrate chick customers, historical chick headers/items, relevant hatch associations, transport, historical prices, adjustments, and applicable coupon information. Preserve original numeric order numbers where practical and evaluate retaining Wix IDs as reconciliation references.

Resolve duplicate numbers, missing submission-log headers, unusual availability records, and other anomalies deliberately. Do not perform a blind copy. Preserve historical prices rather than recalculating current prices. Missing/uncertain hatch dates need reconciliation because reporting is hatch-based.

Wix Stores/adult-layer history is outside this chick migration's scope; reconcile against already imported history to prevent double-counting, without reconstructing that separate system.

## 27. Wix behavior not blindly preserved

Do not preserve browser-authoritative prices, unenforced minimums, broken self-edit pricing/transport preservation, coupon-total inconsistencies, obsolete iframe/data artifacts, the discontinued $5 separation fee, BOGO, or true deletion. Explicit approved transport/wholesale rules override Wix behavior.

## 28. Architecture review questions

Evaluate existing identity and guest matching, historical linking, Supabase buyer authentication, dedicated embed coexistence, pickup reuse, status reuse, Stripe saved-card/off-session payment, shared coupons, hatch availability, shared order versus future-inventory integration, and safe historical migration.

Identify conflicts, reuse points, and required extensions. Do not change approved product decisions without explicit discussion. Unresolved details are listed in the companion implementation plan.

## 29. Guiding V1 principle

Preserve proven Whiting workflows, especially staff operations. Explicit new decisions override old behavior. Where neither provides an answer, flag the question rather than infer a product decision. No implementation is authorized by this document update.
