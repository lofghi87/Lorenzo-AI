-- Enforce per-user access to Lorenzo AI chat records and private attachments.
-- Review/remove any pre-existing broad policies on storage.objects for this bucket
-- before opening the service publicly. Storage is shared by all buckets in Supabase.

begin;

alter table public.chats enable row level security;
revoke all on table public.chats from public, anon;
grant select, insert, update, delete on table public.chats to authenticated;

-- Replace old policies on the app-specific chats table so that a legacy
-- permissive policy cannot accidentally grant cross-account access.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'chats'
  loop
    execute format('drop policy if exists %I on public.chats', policy_row.policyname);
  end loop;
end;
$$;

create policy lorenzo_ai_chats_select_own
  on public.chats for select to authenticated
  using (user_id = (select auth.uid()));

create policy lorenzo_ai_chats_insert_own
  on public.chats for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy lorenzo_ai_chats_update_own
  on public.chats for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy lorenzo_ai_chats_delete_own
  on public.chats for delete to authenticated
  using (user_id = (select auth.uid()));

-- Private Storage policies. Users can only read/upload/delete objects whose
-- first folder is their own Supabase Auth user ID.
drop policy if exists lorenzo_ai_attachments_select_own on storage.objects;
drop policy if exists lorenzo_ai_attachments_insert_own on storage.objects;
drop policy if exists lorenzo_ai_attachments_delete_own on storage.objects;

create policy lorenzo_ai_attachments_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'lorenzo-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy lorenzo_ai_attachments_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'lorenzo-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy lorenzo_ai_attachments_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'lorenzo-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
