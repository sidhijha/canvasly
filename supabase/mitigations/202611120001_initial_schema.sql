create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Guest',
  avatar_url text,
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.create_profile_for_user();

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Untitled board',
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.board_permissions (
  board_id uuid primary key references public.boards(id) on delete cascade,
  link_role text check (link_role in ('editor', 'viewer')),
  link_token text unique,
  updated_at timestamptz not null default now()
);

create table if not exists public.canvas_elements (
  id uuid primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  type text not null check (type in ('rectangle','ellipse','diamond','arrow','line','pencil','text','sticky','image')),
  x double precision not null default 0,
  y double precision not null default 0,
  width double precision not null default 0,
  height double precision not null default 0,
  rotation double precision not null default 0,
  z_index bigint not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists canvas_elements_board_layer on public.canvas_elements(board_id, z_index);
create index if not exists board_members_by_user on public.board_members(user_id, board_id);

create or replace function public.can_access_board(target_board uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.boards b where b.id = target_board and b.owner_id = auth.uid())
  or exists(select 1 from public.board_members m where m.board_id = target_board and m.user_id = auth.uid()); $$;

create or replace function public.can_edit_board(target_board uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.boards b where b.id = target_board and b.owner_id = auth.uid())
  or exists(select 1 from public.board_members m where m.board_id = target_board and m.user_id = auth.uid() and m.role in ('owner','editor')); $$;

create or replace function public.get_shared_board(share_token text)
returns table(id uuid, title text, updated_at timestamptz, owner_id uuid, link_role text)
language sql stable security definer set search_path = public
as $$ select b.id, b.title, b.updated_at, b.owner_id, p.link_role
  from public.board_permissions p join public.boards b on b.id = p.board_id
  where p.link_token = share_token and p.link_role = 'viewer'; $$;

create or replace function public.get_shared_canvas_elements(share_token text)
returns table(id uuid, type text, x double precision, y double precision, width double precision, height double precision, z_index bigint, data jsonb)
language sql stable security definer set search_path = public
as $$ select e.id, e.type, e.x, e.y, e.width, e.height, e.z_index, e.data
  from public.canvas_elements e join public.board_permissions p on p.board_id = e.board_id
  where p.link_token = share_token and p.link_role = 'viewer'; $$;
grant execute on function public.get_shared_board(text) to anon, authenticated;
grant execute on function public.get_shared_canvas_elements(text) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.board_permissions enable row level security;
alter table public.canvas_elements enable row level security;

create policy "Profiles visible to signed in users" on public.profiles for select to authenticated using (true);
create policy "Users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Boards are visible to collaborators or link viewers" on public.boards for select to anon, authenticated using (public.can_access_board(id));
create policy "Users create own boards" on public.boards for insert to authenticated with check (owner_id = auth.uid());
create policy "Owners and editors update boards" on public.boards for update to authenticated using (public.can_edit_board(id)) with check (public.can_edit_board(id));
create policy "Owners delete boards" on public.boards for delete to authenticated using (owner_id = auth.uid());

create policy "Members visible to collaborators" on public.board_members for select to authenticated using (public.can_access_board(board_id));
create policy "Board owners add members" on public.board_members for insert to authenticated with check (exists(select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));
create policy "Board owners update members" on public.board_members for update to authenticated using (exists(select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid())) with check (exists(select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));
create policy "Board owners remove members" on public.board_members for delete to authenticated using (exists(select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));

create policy "Link role visible for accessible boards" on public.board_permissions for select to anon, authenticated using (public.can_access_board(board_id));
create policy "Owners manage link roles" on public.board_permissions for all to authenticated using (exists(select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid())) with check (exists(select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));

create policy "Canvas visible to board viewers" on public.canvas_elements for select to anon, authenticated using (public.can_access_board(board_id));
create policy "Editors add canvas elements" on public.canvas_elements for insert to authenticated with check (public.can_edit_board(board_id));
create policy "Editors update canvas elements" on public.canvas_elements for update to authenticated using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id));
create policy "Editors delete canvas elements" on public.canvas_elements for delete to authenticated using (public.can_edit_board(board_id));

insert into storage.buckets(id, name, public) values ('board-assets', 'board-assets', true)
on conflict (id) do nothing;
create policy "Board collaborators read board assets" on storage.objects for select to anon, authenticated using (
  bucket_id = 'board-assets' and public.can_access_board(split_part(name, '/', 1)::uuid)
);
create policy "Board editors upload board assets" on storage.objects for insert to authenticated with check (
  bucket_id = 'board-assets' and public.can_edit_board(split_part(name, '/', 1)::uuid)
);
create policy "Board editors replace board assets" on storage.objects for update to authenticated using (
  bucket_id = 'board-assets' and public.can_edit_board(split_part(name, '/', 1)::uuid)
) with check (bucket_id = 'board-assets' and public.can_edit_board(split_part(name, '/', 1)::uuid));
create policy "Board editors delete board assets" on storage.objects for delete to authenticated using (
  bucket_id = 'board-assets' and public.can_edit_board(split_part(name, '/', 1)::uuid)
);
