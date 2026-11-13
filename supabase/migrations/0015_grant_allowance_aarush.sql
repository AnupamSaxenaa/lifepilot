-- ============================================================================
-- 0015 — Grant a 10000/day AI allowance to @aarush.2055721
-- ============================================================================
-- Uses the per-account override added in 0014, so no function or default
-- changes: everyone else stays on the standard 20/day.
--
-- Recorded as a migration purely for auditability — it is a DATA change, and
-- re-running it is harmless.
-- ============================================================================

do $$
declare
  v_matched integer;
begin
  update public.profiles
  set daily_token_allowance = 10000,
      daily_free_tokens = 10000,
      daily_free_date = current_date
  where username = 'aarush.2055721';

  get diagnostics v_matched = row_count;

  if v_matched = 0 then
    raise warning 'No profile with username aarush.2055721 — allowance NOT granted. Verify the exact username.';
  else
    raise notice 'Granted 10000/day allowance to % profile(s) for username aarush.2055721.', v_matched;
  end if;
end $$;
