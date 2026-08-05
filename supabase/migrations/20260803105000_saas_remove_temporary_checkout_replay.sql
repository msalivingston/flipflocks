drop function if exists public.get_failed_saas_checkout_completion_replay_state(text);

drop function if exists public.claim_failed_saas_checkout_completion_replay(
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text
);
