import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { CanvasElement } from '../types/canvas';

export type BoardRole = 'owner' | 'editor' | 'viewer';
export type BoardSummary = { id: string; title: string; updated_at: string; owner_id?: string };
export type BoardAccess = { board: BoardSummary; role: BoardRole; shareRole: 'editor' | 'viewer' | null; shareToken?: string };
export type BoardMember = { user_id: string; role: 'editor' | 'viewer'; display_name: string; avatar_url: string | null };
const localListKey = 'canvasly:boards';
const oldCanvasKey = 'canvasly-board';
const localElementsKey = (id: string) => `canvasly:board:${id}`;
const persistedElements = new Map<string, CanvasElement[]>();
const saveQueues = new Map<string, Promise<void>>();
const isLocalBoard = (id: string) => localBoards().some((board) => board.id === id && (!board.owner_id || board.owner_id === 'local'));
const localBoards = (): BoardSummary[] => { try { return JSON.parse(localStorage.getItem(localListKey) ?? '[]') as BoardSummary[]; } catch { return []; } };
const writeLocalBoards = (boards: BoardSummary[]) => localStorage.setItem(localListKey, JSON.stringify(boards));
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
const elementSignature = (element: CanvasElement) => JSON.stringify(Object.keys(element).sort().map((key) => [key, (element as unknown as Record<string, unknown>)[key]]));
export function areCanvasElementsEquivalent(first: CanvasElement, second: CanvasElement) {
  const clean = (element: CanvasElement) => { const value = { ...element }; delete value.imageHref; return elementSignature(value); };
  return clean(first) === clean(second);
}
export function hasUnsavedElementChange(boardId: string, element: CanvasElement) {
  const baseline = persistedElements.get(boardId)?.find((item) => item.id === element.id);
  return !baseline || elementSignature(baseline) !== elementSignature(element);
}
export function observeRemoteElement(boardId: string, element: CanvasElement, zIndex?: number) {
  const current = persistedElements.get(boardId);
  if (!current) return;
  const next = current.filter((item) => item.id !== element.id);
  const index = zIndex === undefined ? next.length : Math.min(Math.max(0, zIndex), next.length);
  next.splice(index, 0, element);
  persistedElements.set(boardId, next);
}
export function observeRemoteDelete(boardId: string, elementId: string) {
  const current = persistedElements.get(boardId);
  if (current) persistedElements.set(boardId, current.filter((item) => item.id !== elementId));
}

export async function listBoards(user: User | null): Promise<BoardSummary[]> {
  if (supabase && user) {
    const { data, error } = await supabase.from('boards').select('id,title,updated_at,owner_id').order('updated_at', { ascending: false });
    fail(error); return data ?? [];
  }
  let boards = localBoards();
  if (!boards.length) {
    const old = localStorage.getItem(oldCanvasKey);
    if (old) {
      const migrated: BoardSummary = { id: crypto.randomUUID(), title: 'Untitled board', updated_at: new Date().toISOString(), owner_id: 'local' };
      localStorage.setItem(localElementsKey(migrated.id), old); boards = [migrated]; writeLocalBoards(boards); localStorage.removeItem(oldCanvasKey);
    }
  }
  return boards;
}

export async function createBoard(title: string, user: User | null): Promise<BoardSummary> {
  if (supabase && user) {
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) throw new Error('Your sign-in session expired. Sign in again, then retry creating the board.');
    const { data, error } = await supabase.rpc('create_board', { board_title: title });
    fail(error);
    const board = Array.isArray(data) ? data[0] : data;
    if (!board) throw new Error('Supabase did not return the new board.');
    return board as BoardSummary;
  }
  const board: BoardSummary = { id: crypto.randomUUID(), title, updated_at: new Date().toISOString(), owner_id: 'local' };
  writeLocalBoards([board, ...localBoards()]); localStorage.setItem(localElementsKey(board.id), '[]'); return board;
}

export async function getBoard(id: string, user: User | null, shareToken?: string): Promise<BoardAccess> {
  if (supabase && shareToken) {
    const { data, error } = await supabase.rpc('get_shared_board', { share_token: shareToken });
    fail(error);
    const shared = Array.isArray(data) ? data[0] : data;
    if (!shared || shared.id !== id) throw new Error('This sharing link is invalid or expired.');
    const shareRole = shared.link_role as 'editor' | 'viewer';
    if (shareRole === 'editor') {
      if (!user) throw new Error('Sign in to edit this shared board.');
      const joined = await supabase.rpc('join_shared_board', { share_token: shareToken }); fail(joined.error);
    }
    return { board: { id: shared.id, title: shared.title, updated_at: shared.updated_at, owner_id: shared.owner_id }, role: shareRole, shareRole, shareToken };
  }
  if (supabase && !isLocalBoard(id)) {
    const { data: row, error } = await supabase.from('boards').select('id,title,updated_at,owner_id').eq('id', id).single();
    fail(error); if (!row) throw new Error('This board was not found or you do not have access.');
    let role: BoardRole | null = user && row.owner_id === user.id ? 'owner' : null;
    if (user && !role) { const member = await supabase.from('board_members').select('role').eq('board_id', id).eq('user_id', user.id).maybeSingle(); fail(member.error); role = member.data?.role as BoardRole | null; }
    const permission = await supabase.from('board_permissions').select('link_role,link_token').eq('board_id', id).maybeSingle(); fail(permission.error);
    const shareRole = permission.data?.link_role as 'editor' | 'viewer' | null;
    if (!role && shareRole) role = shareRole;
    if (!role) throw new Error('This board is private. Ask the owner to share it with you.');
    return { board: row as BoardSummary, role, shareRole, shareToken: role === 'owner' ? permission.data?.link_token ?? undefined : undefined };
  }
  const board = localBoards().find((item) => item.id === id);
  if (!board) throw new Error('This board is not available in this browser.');
  return { board, role: 'owner', shareRole: null };
}

export async function loadElements(id: string, shareToken?: string, sharedEditor = false): Promise<CanvasElement[]> {
  if (!supabase || isLocalBoard(id)) { try { return JSON.parse(localStorage.getItem(localElementsKey(id)) ?? '[]') as CanvasElement[]; } catch { return []; } }
  if (shareToken && !sharedEditor) {
    const client = supabase;
    const { data, error } = await client.rpc('get_shared_canvas_elements', { share_token: shareToken }); fail(error);
    const rows = (data ?? []) as Array<{ id: string; type: string; x: number; y: number; width: number; height: number; z_index: number; data: unknown }>;
    const elements = await Promise.all(rows.map(async (row) => {
      const payload = row.data as Omit<CanvasElement, 'imageHref'> & { imageHref?: string; imagePath?: string };
      let imageHref = payload.imageHref;
      if (payload.imagePath) imageHref = client.storage.from('board-assets').getPublicUrl(payload.imagePath).data.publicUrl;
      return { ...payload, id: row.id, type: row.type, x: row.x, y: row.y, width: row.width, height: row.height, imageHref } as CanvasElement;
    }));
    return elements;
  }
  const client = supabase;
  const { data, error } = await client.from('canvas_elements').select('id,type,x,y,width,height,z_index,data').eq('board_id', id).order('z_index');
  fail(error);
  const elements = await Promise.all((data ?? []).map(async (row) => {
    const payload = row.data as Omit<CanvasElement, 'imageHref'> & { imageHref?: string; imagePath?: string };
    let imageHref = payload.imageHref;
    if (payload.imagePath) { const signed = await client.storage.from('board-assets').createSignedUrl(payload.imagePath, 60 * 60 * 24 * 7); fail(signed.error); if (signed.data) imageHref = signed.data.signedUrl; }
    return { ...payload, id: row.id, type: row.type, x: row.x, y: row.y, width: row.width, height: row.height, imageHref } as CanvasElement;
  }));
  persistedElements.set(id, elements);
  return elements;
}

export async function saveElements(id: string, elements: CanvasElement[]): Promise<void> {
  if (!supabase || isLocalBoard(id)) { localStorage.setItem(localElementsKey(id), JSON.stringify(elements)); const boards = localBoards().map((board) => board.id === id ? { ...board, updated_at: new Date().toISOString() } : board); writeLocalBoards(boards); return; }
  const previousSave = saveQueues.get(id) ?? Promise.resolve();
  const nextSave = previousSave.catch(() => undefined).then(() => saveCloudElements(id, elements));
  saveQueues.set(id, nextSave);
  try { await nextSave; }
  finally { if (saveQueues.get(id) === nextSave) saveQueues.delete(id); }
}

async function saveCloudElements(id: string, elements: CanvasElement[]): Promise<void> {
  const client = supabase;
  if (!client) return;
  const previous = persistedElements.get(id) ?? [];
  const previousById = new Map(previous.map((element, z_index) => [element.id, { element, z_index }]));
  const currentIds = new Set(elements.map((element) => element.id));
  const changed = elements.filter((element, z_index) => {
    const old = previousById.get(element.id);
    return !old || old.z_index !== z_index || elementSignature(old.element) !== elementSignature(element);
  });
  const removedIds = previous.filter((element) => !currentIds.has(element.id)).map((element) => element.id);
  if (!changed.length && !removedIds.length) return;
  const changedIndexes = new Map(changed.map((element) => [element.id, elements.indexOf(element)]));
  const rows = await Promise.all(changed.map(async (element) => {
    const z_index = changedIndexes.get(element.id) ?? 0;
    const payload: Record<string, unknown> = { ...element }; delete payload.id; delete payload.type; delete payload.x; delete payload.y; delete payload.width; delete payload.height;
    if (element.imageHref?.startsWith('data:')) {
      const response = await fetch(element.imageHref); const blob = await response.blob(); const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      const imagePath = `${id}/${element.id}.${ext}`;
      const upload = await client.storage.from('board-assets').upload(imagePath, blob, { upsert: true, contentType: blob.type }); fail(upload.error);
      delete payload.imageHref; payload.imagePath = imagePath;
    } else if (element.imageHref) {
      const match = element.imageHref.match(/\/storage\/v1\/object\/(?:sign|public)\/board-assets\/([^?]+)/);
      if (match) { delete payload.imageHref; payload.imagePath = decodeURIComponent(match[1]); }
    }
    return { id: element.id, board_id: id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height, z_index, data: payload };
  }));
  if (rows.length) { const { error } = await client.from('canvas_elements').upsert(rows); fail(error); }
  if (removedIds.length) { const { error } = await client.from('canvas_elements').delete().eq('board_id', id).in('id', removedIds); fail(error); }
  const { error } = await client.from('boards').update({ updated_at: new Date().toISOString() }).eq('id', id); fail(error);
  persistedElements.set(id, elements);
}

export async function renameBoard(id: string, title: string): Promise<void> {
  if (supabase && !isLocalBoard(id)) { const { error } = await supabase.from('boards').update({ title, updated_at: new Date().toISOString() }).eq('id', id); fail(error); return; }
  writeLocalBoards(localBoards().map((board) => board.id === id ? { ...board, title, updated_at: new Date().toISOString() } : board));
}

export async function deleteBoard(id: string): Promise<void> {
  if (supabase && !isLocalBoard(id)) { const { error } = await supabase.from('boards').delete().eq('id', id); fail(error); return; }
  writeLocalBoards(localBoards().filter((board) => board.id !== id)); localStorage.removeItem(localElementsKey(id));
}

export async function setShareRole(id: string, role: 'viewer' | 'editor' | null): Promise<string | null> {
  if (!supabase) throw new Error('Sharing requires a Supabase connection.');
  const { data, error } = await supabase.rpc('set_board_share_role', { target_board: id, requested_role: role }); fail(error);
  return data;
}

export async function listBoardMembers(id: string): Promise<BoardMember[]> {
  if (!supabase) return [];
  const { data: memberships, error } = await supabase.from('board_members').select('user_id,role').eq('board_id', id).order('joined_at');
  fail(error);
  if (!memberships?.length) return [];
  const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,display_name,avatar_url').in('id', memberships.map((member) => member.user_id));
  fail(profileError);
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return memberships.map((member) => ({ user_id: member.user_id, role: member.role as 'editor' | 'viewer', display_name: byId.get(member.user_id)?.display_name ?? 'Collaborator', avatar_url: byId.get(member.user_id)?.avatar_url ?? null }));
}

export async function setBoardMemberRole(boardId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
  if (!supabase) throw new Error('Member management requires a Supabase connection.');
  const { data, error } = await supabase.from('board_members').update({ role }).eq('board_id', boardId).eq('user_id', userId).select('user_id').maybeSingle();
  fail(error);
  if (!data) throw new Error('Only the board owner can change member access.');
}

export async function removeBoardMember(boardId: string, userId: string): Promise<void> {
  if (!supabase) throw new Error('Member management requires a Supabase connection.');
  const { data, error } = await supabase.from('board_members').delete().eq('board_id', boardId).eq('user_id', userId).select('user_id').maybeSingle();
  fail(error);
  if (!data) throw new Error('Only the board owner can remove a member.');
}
