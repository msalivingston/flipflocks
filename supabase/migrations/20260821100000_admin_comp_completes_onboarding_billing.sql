-- An active administrative comp is billing authority, so it completes only
-- onboarding's billing checkpoint. All other onboarding progress stays owned
-- by the existing seller onboarding flow.
begin;

alter function public.admin_grant_store_comp(uuid, text, text, timestamptz)
  rename to admin_grant_store_comp_entitlement_v1;

revoke all on function public.admin_grant_store_comp_entitlement_v1(uuid, text, text, timestamptz)
  from public, anon, authenticated;

create function public.admin_grant_store_comp(
  p_store_id uuid,
  p_plan_key text,
  p_reason text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform public.admin_grant_store_comp_entitlement_v1(
    p_store_id,
    p_plan_key,
    p_reason,
    p_expires_at
  );

  update public.seller_onboarding_state
  set billing_complete = true
  where store_id = p_store_id
    and billing_complete = false;
end;
$function$;

comment on function public.admin_grant_store_comp(uuid, text, text, timestamptz) is
'Admin-only, audited, time-limited comp grant. A successful comp completes only the seller onboarding billing checkpoint.';

revoke all on function public.admin_grant_store_comp(uuid, text, text, timestamptz)
  from public, anon;
grant execute on function public.admin_grant_store_comp(uuid, text, text, timestamptz)
  to authenticated;

-- Repair current comped stores, including Whiting Farms, without re-granting
-- access or changing any non-billing onboarding state. The entitlement
-- resolver is the authoritative active-comp predicate.
update public.seller_onboarding_state as onboarding
set billing_complete = true
from (
  select candidate.store_id
  from public.seller_onboarding_state as candidate
  cross join lateral public.resolve_store_entitlement(candidate.store_id) as entitlement
  where candidate.billing_complete = false
    and entitlement.has_active_access
    and entitlement.access_reason = 'admin_comp'
) as active_comp
where onboarding.store_id = active_comp.store_id
  and onboarding.billing_complete = false;

commit;
