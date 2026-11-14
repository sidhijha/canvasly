create or replace function public.set_board_owner_from_auth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to create a board';
  end if;
  new.owner_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists set_board_owner_before_insert on public.boards;
create trigger set_board_owner_before_insert
before insert on public.boards
for each row execute function public.set_board_owner_from_auth();
