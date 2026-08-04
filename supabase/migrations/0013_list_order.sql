-- ============================================================================
-- 0013 — Persist custom list order on the server
-- ============================================================================
-- Sidebar list order was previously stored ONLY in AsyncStorage
-- (`list_order_<userId>`), so clearing app data or reinstalling reset the
-- arrangement to creation order. This adds the missing server column so the
-- order is part of the account, exactly like task `order_index`.
--
-- Safe to run more than once.
-- ============================================================================

alter table public.lists
  add column if not exists order_index integer;

-- Backfill existing rows deterministically by creation time, per user, so
-- current sidebars keep their present top-to-bottom order after deploy.
with ranked as (
  select
    id,
    row_number() over (partition by user_id order by created_at asc, id asc) - 1 as position
  from public.lists
)
update public.lists as l
set order_index = ranked.position
from ranked
where l.id = ranked.id
  and l.order_index is null;

-- Ordering reads are always scoped to one user.
create index if not exists lists_user_order_idx
  on public.lists (user_id, order_index);
