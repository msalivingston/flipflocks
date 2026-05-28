-- Fix order idempotency hashing inside security-definer order functions.
--
-- Supabase projects commonly install pgcrypto into the `extensions` schema.
-- These functions intentionally use a restricted search_path; include
-- `extensions` so pgcrypto.digest(...) resolves without changing order logic.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text,
  uuid
) set search_path = public, extensions;

alter function public.seller_create_manual_order(
  uuid,
  text,
  jsonb,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  boolean,
  boolean
) set search_path = public, extensions;

alter function public.seller_record_refund(
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) set search_path = public, extensions;
