# Group 61 - Customer Detail Foundation

## Summary

Group 61 turns Customers into a read-only seller lookup surface. The goal is customer visibility, not CRM: sellers can quickly see who a customer is, how to contact them, how often they buy, and which orders they have placed.

## Existing Data Used

- `seller_customer_summary` powers the customer list.
- `seller_customer_detail` powers the customer summary and pickup/contact details.
- `seller_order_management` powers customer order history.

No backend migration, RPC, or projection change was needed. First order date is derived from the customer order history instead of adding a new projection field.

## Behavior

- `/dashboard/customers` shows customer name, email, phone, total orders, lifetime spend, and most recent order date.
- `/dashboard/customers/[customerId]` shows customer contact details, purchase summary, pickup location when available, and read-only order history.
- Order history links back to seller order detail pages.
- Missing phone or pickup location fields display plain fallback text.

## Intentional Limits

- No customer editing.
- No tags.
- No CRM notes.
- No messaging.
- No exports.
- No bulk actions.
