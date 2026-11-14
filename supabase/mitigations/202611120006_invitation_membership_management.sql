alter table public.board_members
  add column if not exists invited_by_link boolean not null default false;

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

  insert into public.board_members(board_id, user_id, role, invited_by_link)
  values (target_board, current_user_id, 'editor', true)
  on conflict (board_id, user_id) do update
    set role = 'editor', invited_by_link = true
    where public.board_members.role <> 'owner';

  return target_board;
end;
$$;

create or replace function public.set_board_share_role(target_board uuid, requested_role text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_token text;
begin
  if current_user_id is null or not exists (
    select 1 from public.boards b where b.id = target_board and b.owner_id = current_user_id
  ) then
    raise exception 'Only the board owner can change its link access';
  end if;

  if requested_role is not null and requested_role not in ('viewer', 'editor') then
    raise exception 'Invalid board link role';
  end if;

  new_token := case when requested_role is null then null else gen_random_uuid()::text end;
  insert into public.board_permissions(board_id, link_role, link_token, updated_at)
  values (target_board, requested_role, new_token, now())
  on conflict (board_id) do update
    set link_role = excluded.link_role, link_token = excluded.link_token, updated_at = excluded.updated_at;

  if requested_role = 'viewer' then
    update public.board_members set role = 'viewer'
    where board_id = target_board and invited_by_link and role = 'editor';
  elsif requested_role is null then
    delete from public.board_members where board_id = target_board and invited_by_link;
  end if;

  return new_token;
end;
$$;

revoke all on function public.join_shared_board(text) from public;
grant execute on function public.join_shared_board(text) to authenticated;
revoke all on function public.set_board_share_role(uuid, text) from public;
grant execute on function public.set_board_share_role(uuid, text) to authenticated;
