create or replace function public.get_shared_board(share_token text)
returns table(id uuid, title text, updated_at timestamptz, owner_id uuid, link_role text)
language sql stable security definer set search_path = public
as $$
  select b.id, b.title, b.updated_at, b.owner_id, p.link_role
  from public.board_permissions p
  join public.boards b on b.id = p.board_id
  where p.link_token = share_token and p.link_role in ('viewer', 'editor');
$$;

create or replace function public.join_shared_board(share_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_board uuid;
begin
  if current_user_id is null then
    raise exception 'Sign in is required to edit a shared board';
  end if;

  select p.board_id into target_board
  from public.board_permissions p
  where p.link_token = share_token and p.link_role = 'editor';

  if target_board is null then
    raise exception 'This is not a valid edit invitation';
  end if;

  insert into public.board_members(board_id, user_id, role)
  values (target_board, current_user_id, 'editor')
  on conflict (board_id, user_id) do update set role = 'editor'
  where public.board_members.role <> 'owner';

  return target_board;
end;
$$;

revoke all on function public.join_shared_board(text) from public;
grant execute on function public.join_shared_board(text) to authenticated;
grant execute on function public.get_shared_board(text) to anon, authenticated;
