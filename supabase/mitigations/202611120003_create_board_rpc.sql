create or replace function public.create_board(board_title text)
returns table(id uuid, title text, updated_at timestamptz, owner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_owner uuid := auth.uid();
  created_board public.boards%rowtype;
begin
  if current_owner is null then
    raise exception 'Sign in is required to create a board';
  end if;

  insert into public.boards(owner_id, title)
  values (current_owner, coalesce(nullif(btrim(board_title), ''), 'Untitled board'))
  returning * into created_board;

  return query select created_board.id, created_board.title, created_board.updated_at, created_board.owner_id;
end;
$$;

revoke all on function public.create_board(text) from public;
grant execute on function public.create_board(text) to authenticated;
