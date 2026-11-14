create or replace function public.broadcast_canvas_element_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'board:' || old.board_id::text,
    'DELETE',
    'DELETE',
    'canvas_elements',
    'public',
    null,
    old
  );
  return old;
end;
$$;

drop trigger if exists on_canvas_element_deleted on public.canvas_elements;
create trigger on_canvas_element_deleted
after delete on public.canvas_elements
for each row execute function public.broadcast_canvas_element_delete();
