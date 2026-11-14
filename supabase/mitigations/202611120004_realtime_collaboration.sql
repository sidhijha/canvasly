do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'canvas_elements'
  ) then
    alter publication supabase_realtime add table public.canvas_elements;
  end if;
end;
$$;

drop policy if exists "Board collaborators receive realtime messages" on realtime.messages;
create policy "Board collaborators receive realtime messages"
on realtime.messages for select to authenticated
using (
  realtime.topic() ~ '^board:[0-9a-fA-F-]{36}$'
  and public.can_access_board(substring(realtime.topic() from 7)::uuid)
);

drop policy if exists "Board collaborators send realtime messages" on realtime.messages;
create policy "Board collaborators send realtime messages"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() ~ '^board:[0-9a-fA-F-]{36}$'
  and public.can_access_board(substring(realtime.topic() from 7)::uuid)
);
