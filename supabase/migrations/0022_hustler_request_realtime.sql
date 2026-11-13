-- 0022 — live Hustler request notifications + friendship update hardening
-- Apply deliberately after 0017 and 0021. Safe to rerun.

-- Realtime only accelerates the cache-first client. Focus and polling remain
-- active when the publication is unavailable.
do $realtime$
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;
end
$realtime$;

-- 0017's original policy allowed either participant to accept a request.
-- Recipients may accept/block; requesters may only withdraw by blocking.
drop policy if exists "friendships_update_involved" on public.friendships;
drop policy if exists "friendships_addressee_manage" on public.friendships;
drop policy if exists "friendships_requester_block" on public.friendships;

create policy "friendships_addressee_manage" on public.friendships
  for update
  using (
    auth.uid() = addressee_id
    and status in ('pending', 'accepted')
  )
  with check (
    auth.uid() = addressee_id
    and status in ('accepted', 'blocked')
  );

create policy "friendships_requester_block" on public.friendships
  for update
  using (
    auth.uid() = requester_id
    and status in ('pending', 'accepted')
  )
  with check (
    auth.uid() = requester_id
    and status = 'blocked'
  );