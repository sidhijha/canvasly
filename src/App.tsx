import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { User } from '@supabase/supabase-js';
import { MousePointer2, Hand, Square, Circle, Diamond, MoveUpRight, Minus, Pencil, Eraser, Type, StickyNote, ImagePlus, Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Grid2X2, Share2, ChevronDown, Sparkles, MoreHorizontal, ArrowLeft, Download, FileJson, Image as ImageIcon, FileImage, Upload, X } from 'lucide-react';
import Canvas, { type RemoteCursor } from './components/Canvas';
import PropertiesPanel from './components/PropertiesPanel';
import AuthScreen from './components/AuthScreen';
import BoardsHome from './components/BoardsHome';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { useCanvasStore } from './stores/canvasStore';
import type { Point, Tool } from './types/canvas';
import { areCanvasElementsEquivalent, getBoard, hasUnsavedElementChange, listBoardMembers, loadElements, observeRemoteDelete, observeRemoteElement, removeBoardMember, renameBoard, saveElements, setBoardMemberRole, setShareRole, type BoardAccess, type BoardMember, type BoardSummary } from './services/boardService';
import { exportJson, exportPng, exportSvg, readBoardFile } from './services/exportService';

const toolItems: { id: Tool; label: string; shortcut: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 }, { id: 'hand', label: 'Hand', shortcut: 'H', icon: Hand },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: Square }, { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: Circle },
  { id: 'diamond', label: 'Diamond', shortcut: 'D', icon: Diamond }, { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: MoveUpRight },
  { id: 'line', label: 'Line', shortcut: 'L', icon: Minus }, { id: 'pencil', label: 'Draw', shortcut: 'P', icon: Pencil },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', icon: Eraser }, { id: 'text', label: 'Text', shortcut: 'T', icon: Type },
  { id: 'sticky', label: 'Sticky note', shortcut: 'N', icon: StickyNote }, { id: 'image', label: 'Image', shortcut: 'I', icon: ImagePlus },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<'loading' | 'auth' | 'home' | 'editor'>('loading');
  const [access, setAccess] = useState<BoardAccess | null>(null);
  const [openError, setOpenError] = useState('');
  useEffect(() => {
    let active = true;
    const start = async () => {
      const result = supabase ? await supabase.auth.getSession() : null;
      const currentUser = result?.data.session?.user ?? null;
      if (!active) return;
      setUser(currentUser);
      const boardId = new URLSearchParams(window.location.search).get('board');
      const shareToken = new URLSearchParams(window.location.search).get('share') ?? undefined;
      if (boardId) {
        try { const board = await getBoard(boardId, currentUser, shareToken); if (!active) return; setAccess(board); setScreen('editor'); return; }
        catch (reason) { if (active) setOpenError(reason instanceof Error ? reason.message : 'Could not open that board.'); }
      }
      if (active) setScreen(isSupabaseConfigured && !currentUser ? 'auth' : 'home');
    };
    void start();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'SIGNED_IN' && session?.user) {
        const boardId = new URLSearchParams(window.location.search).get('board');
        const shareToken = new URLSearchParams(window.location.search).get('share') ?? undefined;
        if (boardId && shareToken) {
          setScreen('loading');
          void getBoard(boardId, session.user, shareToken).then((board) => { setAccess(board); setScreen('editor'); }).catch((reason) => { setOpenError(reason instanceof Error ? reason.message : 'Could not open that board.'); setScreen('home'); });
        } else setScreen((current) => current === 'auth' ? 'home' : current);
      }
    }).data.subscription;
    return () => { active = false; subscription?.unsubscribe(); };
  }, []);
  const openBoard = async (summary: BoardSummary) => {
    setScreen('loading'); setOpenError('');
    try { const board = await getBoard(summary.id, user); setAccess(board); window.history.pushState({}, '', `${window.location.pathname}?board=${summary.id}`); setScreen('editor'); }
    catch (reason) { setOpenError(reason instanceof Error ? reason.message : 'Could not open the board.'); setScreen('home'); }
  };
  const backHome = () => { window.history.replaceState({}, '', window.location.pathname); setAccess(null); setScreen(isSupabaseConfigured && !user ? 'auth' : 'home'); };
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); setUser(null); setAccess(null); setScreen(isSupabaseConfigured ? 'auth' : 'home'); };
  if (screen === 'loading') return <div className="screen-loading">Opening Canvasly…</div>;
  if (screen === 'auth') return <AuthScreen onGuest={() => { setUser(null); setScreen('home'); }} />;
  if (screen === 'home') return <BoardsHome user={user} onOpen={(board) => void openBoard(board)} onSignOut={() => void signOut()} onGuest={() => setScreen('auth')} initialError={openError} />;
  if (access) return <Whiteboard access={access} user={user} onBack={backHome} onAccessChange={setAccess} />;
  return <div className="screen-loading">{openError || 'Loading…'}</div>;
}

function Whiteboard({ access: initialAccess, user, onBack, onAccessChange }: { access: BoardAccess; user: User | null; onBack: () => void; onAccessChange: (access: BoardAccess) => void }) {
  const [access, setAccess] = useState(initialAccess);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflictNotice, setConflictNotice] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [collaborators, setCollaborators] = useState<Array<{ userId: string; name: string; color: string; cursor: Point | null }>>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const cursorLastSent = useRef(0);
  const pendingSaves = useRef(0);
  const [shareRole, setCurrentShareRole] = useState<'viewer' | 'editor' | null>(access.shareRole);
  const [boardTitle, setBoardTitle] = useState(access.board.title);
  const [renameMode, setRenameMode] = useState(false);
  const [renameValue, setRenameValue] = useState(access.board.title);
  const readOnly = access.role === 'viewer';
  useEffect(() => { setAccess(initialAccess); }, [initialAccess]);
  useEffect(() => { setCurrentShareRole(access.shareRole); setBoardTitle(access.board.title); setRenameValue(access.board.title); }, [access]);
  useEffect(() => {
    if (!shareOpen || access.role !== 'owner') return;
    let active = true; setMembersLoading(true);
    void listBoardMembers(access.board.id).then((members) => { if (active) setBoardMembers(members); }).catch((reason) => { if (active) setSaveError(reason instanceof Error ? reason.message : 'Could not load board members.'); }).finally(() => { if (active) setMembersLoading(false); });
    return () => { active = false; };
  }, [shareOpen, access.board.id, access.role, collaborators.length]);
  useEffect(() => {
    let active = true; setLoaded(false); setSaveError('');
    void loadElements(initialAccess.board.id, initialAccess.shareToken, initialAccess.shareRole === 'editor').then((items) => { if (active) { useCanvasStore.getState().loadElements(items); setLoaded(true); } }).catch((reason) => { if (active) { setSaveError(reason instanceof Error ? reason.message : 'Could not load board elements.'); setLoaded(true); } });
    return () => { active = false; };
  }, [initialAccess.board.id]);

  useEffect(() => {
    if (!loaded || !supabase || !user || (access.role === 'viewer' && Boolean(access.shareToken)) || access.board.owner_id === 'local') return;
    let active = true;
    const client = supabase;
    const color = `hsl(${Math.abs([...user.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)) % 360} 68% 48%)`;
    const name = String(user.user_metadata.display_name ?? user.email?.split('@')[0] ?? 'Collaborator');
    const channel = client.channel(`board:${access.board.id}`, { config: { private: true, presence: { key: user.id } } });
    channel.on('presence', { event: 'sync' }, () => {
      if (!active) return;
      const entries = Object.values(channel.presenceState()).flat() as Array<Record<string, unknown>>;
      const people = new Map<string, { userId: string; name: string; color: string; cursor: Point | null }>();
      entries.forEach((entry) => {
        if (typeof entry.userId === 'string') people.set(entry.userId, { userId: entry.userId, name: String(entry.name ?? 'Collaborator'), color: String(entry.color ?? '#6558e8'), cursor: entry.cursor && typeof entry.cursor === 'object' ? entry.cursor as Point : null });
      });
      setCollaborators([...people.values()]);
    });
    channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      if (!active || payload.userId === user.id) return;
      setRemoteCursors((current) => [...current.filter((cursor) => cursor.userId !== payload.userId), { userId: String(payload.userId), name: String(payload.name), color: String(payload.color), x: Number(payload.x), y: Number(payload.y) }]);
    });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'canvas_elements', filter: `board_id=eq.${access.board.id}` }, async (change) => {
      if (!active) return;
      const state = useCanvasStore.getState();
      if (change.eventType === 'DELETE') {
        const elementId = String(change.old.id), localElement = state.elements.find((element) => element.id === elementId);
        if (localElement && hasUnsavedElementChange(access.board.id, localElement)) setConflictNotice('An object you were changing was deleted by another collaborator. Their deletion was kept.');
        observeRemoteDelete(access.board.id, elementId); state.removeRemoteElement(elementId); return;
      }
      const row = change.new as { id: string; type: string; x: number; y: number; width: number; height: number; z_index: number; data: Record<string, unknown> };
      const payload = { ...row.data } as Record<string, unknown>;
      if (typeof payload.imagePath === 'string') payload.imageHref = client.storage.from('board-assets').getPublicUrl(payload.imagePath).data.publicUrl;
      delete payload.imagePath;
      const element = { ...payload, id: row.id, type: row.type, x: row.x, y: row.y, width: row.width, height: row.height } as import('./types/canvas').CanvasElement;
      const localElement = state.elements.find((item) => item.id === element.id);
      if (localElement && hasUnsavedElementChange(access.board.id, localElement) && !areCanvasElementsEquivalent(localElement, element)) setConflictNotice('An object you were changing was also edited elsewhere. The latest saved version is shown.');
      observeRemoteElement(access.board.id, element, row.z_index);
      state.applyRemoteElement(element, row.z_index);
    });
    channel.on('broadcast', { event: 'DELETE' }, ({ payload }) => {
      const deleted = payload.old_record as { id?: string } | undefined;
      if (!active || !deleted?.id) return;
      const state = useCanvasStore.getState();
      const elementId = String(deleted.id);
      const localElement = state.elements.find((element) => element.id === elementId);
      if (localElement && hasUnsavedElementChange(access.board.id, localElement)) setConflictNotice('An object you were changing was deleted by another collaborator. Their deletion was kept.');
      observeRemoteDelete(access.board.id, elementId);
      state.removeRemoteElement(elementId);
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ userId: user.id, name, color, cursor: null });
    });
    return () => { active = false; void client.removeChannel(channel); };
  }, [loaded, access.board.id, access.board.owner_id, access.role, user]);

  const broadcastCursor = (point: Point) => {
    const now = performance.now();
    if (!user || now - cursorLastSent.current < 40) return;
    cursorLastSent.current = now;
    const channel = supabase?.getChannels().find((item) => item.topic === `realtime:board:${access.board.id}`);
    if (channel) void channel.send({ type: 'broadcast', event: 'cursor', payload: { userId: user.id, name: String(user.user_metadata.display_name ?? user.email?.split('@')[0] ?? 'Collaborator'), color: `hsl(${Math.abs([...user.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)) % 360} 68% 48%)`, x: point.x, y: point.y } });
  };

  const { tool, setTool, viewport, setViewport, gridVisible, toggleGrid, dirty, past, future, elements } = useCanvasStore();
  const saveNow = async () => {
    const snapshot = useCanvasStore.getState().elements;
    pendingSaves.current += 1; setSaving(true); setSaveError('');
    try { await saveElements(access.board.id, snapshot); if (useCanvasStore.getState().elements === snapshot) useCanvasStore.getState().markSaved(); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not save this board.'); }
    finally { pendingSaves.current = Math.max(0, pendingSaves.current - 1); setSaving(pendingSaves.current > 0); }
  };
  useEffect(() => {
    if (!loaded || readOnly || !dirty) return;
    const timer = window.setTimeout(() => { void saveNow(); }, 800);
    return () => window.clearTimeout(timer);
  }, [loaded, readOnly, dirty, elements, access.board.id]);
  useEffect(() => {
    const shortcuts: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rectangle', o: 'ellipse', d: 'diamond', a: 'arrow', l: 'line', p: 'pencil', e: 'eraser', t: 'text', n: 'sticky', i: 'image' };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.ctrlKey || event.metaKey || event.altKey || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const nextTool = shortcuts[event.key.toLowerCase()]; if (nextTool && (!readOnly || nextTool === 'select' || nextTool === 'hand')) setTool(nextTool);
    };
    const onHistory = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(event.ctrlKey || event.metaKey) || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const state = useCanvasStore.getState();
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? state.redo() : state.undo(); }
      else if (event.key.toLowerCase() === 'y') { event.preventDefault(); state.redo(); }
      else if (event.key.toLowerCase() === 'd' && !readOnly) { event.preventDefault(); state.duplicateSelected(); }
      else if (event.key.toLowerCase() === 'a') { event.preventDefault(); state.selectAll(); }
      else if (event.key.toLowerCase() === 'g' && !readOnly) { event.preventDefault(); event.shiftKey ? state.ungroupSelected() : state.groupSelected(); }
      else if (event.key.toLowerCase() === 's' && !readOnly) { event.preventDefault(); void saveNow(); }
    };
    const onDelete = (event: KeyboardEvent) => { if (!readOnly && (event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) useCanvasStore.getState().deleteSelected(); };
    window.addEventListener('keydown', onKey); window.addEventListener('keydown', onHistory); window.addEventListener('keydown', onDelete);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', onHistory); window.removeEventListener('keydown', onDelete); };
  }, [setTool, readOnly, access.board.id]);
  const changeZoom = (delta: number) => setViewport({ ...viewport, zoom: Math.min(3, Math.max(.2, viewport.zoom + delta)) });
  const fit = () => setViewport({ x: 0, y: 0, zoom: 1 });
  const commitRename = async () => {
    const next = renameValue.trim(); if (!next || next === boardTitle) { setRenameMode(false); return; }
    try { await renameBoard(access.board.id, next); setBoardTitle(next); setAccess((current) => ({ ...current, board: { ...current.board, title: next } })); setRenameMode(false); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not rename board.'); }
  };
  const updateShare = async (value: string) => {
    const role: 'viewer' | 'editor' | null = value === 'viewer' ? 'viewer' : value === 'editor' ? 'editor' : null;
    try { const shareToken = await setShareRole(access.board.id, role); setCurrentShareRole(role); const next = { ...access, shareRole: role, shareToken: role ? shareToken ?? undefined : undefined }; setAccess(next); onAccessChange(next); setBoardMembers(await listBoardMembers(access.board.id)); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not update sharing.'); }
  };
  const changeMemberRole = async (member: BoardMember, role: 'editor' | 'viewer') => {
    try { await setBoardMemberRole(access.board.id, member.user_id, role); setBoardMembers((current) => current.map((item) => item.user_id === member.user_id ? { ...item, role } : item)); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not change member access.'); }
  };
  const removeMember = async (member: BoardMember) => {
    try { await removeBoardMember(access.board.id, member.user_id); setBoardMembers((current) => current.filter((item) => item.user_id !== member.user_id)); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not remove this member.'); }
  };
  const copyLink = async () => { if (!access.shareToken) return; await navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?board=${access.board.id}&share=${access.shareToken}`); setShareOpen(false); };
  const signOut = async () => { await supabase?.auth.signOut(); onBack(); };
  const importBoard = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const boardFile = await readBoardFile(file);
      useCanvasStore.getState().replaceElements(boardFile.elements);
      if (boardFile.title?.trim()) { await renameBoard(access.board.id, boardFile.title.trim()); setBoardTitle(boardFile.title.trim()); }
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not import this board.'); }
    finally { event.target.value = ''; }
  };
  const runExport = async (format: 'json' | 'svg' | 'png') => {
    try { if (format === 'json') await exportJson(boardTitle, elements); else if (format === 'svg') await exportSvg(boardTitle, elements); else await exportPng(boardTitle, elements); setExportOpen(false); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not export this board.'); }
  };
  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><button className="back-home" title="All boards" onClick={onBack}><ArrowLeft size={17}/></button><div className="brand-mark"><Sparkles size={18} strokeWidth={2.4}/></div><span>canvasly</span><span className="brand-divider"/>{renameMode ? <input className="board-name-input" autoFocus value={renameValue} maxLength={80} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => void commitRename()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); event.stopPropagation(); }}/> : <button className="board-name" title="Rename board" onClick={() => { setRenameValue(boardTitle); if (!readOnly) setRenameMode(true); }}>{boardTitle}{!readOnly && <ChevronDown size={14}/>}</button>}</div>
      <div className="save-state" role="status" aria-live="polite"><span className={`save-dot ${dirty || saveError ? 'save-dot-dirty' : ''}`}/><span>{saveError ? 'Save error' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : loaded ? 'Saved' : 'Loading board…'}</span></div>
      <div className="top-actions">
        <div className="avatar-stack"><span className="avatar avatar-you" title={user?.email ?? 'Guest'}>{(user?.user_metadata.display_name ?? user?.email ?? 'Y').slice(0,1).toUpperCase()}</span>{collaborators.filter((person) => person.userId !== user?.id).slice(0,4).map((person) => <span key={person.userId} className="avatar" style={{ background: person.color }} title={`${person.name} is here`}>{person.name.slice(0,1).toUpperCase()}</span>)}</div>
        {!readOnly && <div className="export-wrap"><button className="button button-secondary" onClick={() => setExportOpen(!exportOpen)}><Download size={15}/> Export</button>{exportOpen && <div className="export-menu"><button onClick={() => void runExport('png')}><ImageIcon size={15}/> PNG image</button><button onClick={() => void runExport('svg')}><FileImage size={15}/> SVG vector</button><button onClick={() => void runExport('json')}><FileJson size={15}/> JSON file</button><span/><button onClick={() => { setExportOpen(false); importRef.current?.click(); }}><Upload size={15}/> Import JSON</button></div>}</div>}
        {access.role === 'owner' && <button className="button button-secondary" onClick={() => setShareOpen(!shareOpen)} disabled={!isSupabaseConfigured}><Share2 size={15}/> Share</button>}
        {shareOpen && access.role === 'owner' && <div className="share-popover"><div className="popover-title">Share this board</div><p>View links are public. Edit links require sign-in; switching to view or private removes edit access granted by the link.</p><label className="share-role-label">Link access<select value={shareRole ?? 'private'} onChange={(event) => void updateShare(event.target.value)}><option value="private">Private</option><option value="viewer">Can view</option><option value="editor">Can edit (sign-in required)</option></select></label><button className="button button-primary copy-button" disabled={!shareRole || !access.shareToken} onClick={() => void copyLink()}>Copy board link</button>
          <div className="member-list"><div className="member-list-heading">Board members</div>{membersLoading ? <div className="member-empty">Loading members…</div> : boardMembers.length === 0 ? <div className="member-empty">No invited members yet.</div> : boardMembers.map((member) => <div className="member-row" key={member.user_id}><span className="member-avatar">{member.display_name.slice(0, 1).toUpperCase()}</span><span className="member-name" title={member.display_name}>{member.display_name}</span><select aria-label={`Access for ${member.display_name}`} value={member.role} onChange={(event) => void changeMemberRole(member, event.target.value as 'editor' | 'viewer')}><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button className="member-remove" title={`Remove ${member.display_name}`} aria-label={`Remove ${member.display_name}`} onClick={() => void removeMember(member)}><X size={14}/></button></div>)}</div>
        </div>}
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importBoard}/><button className="icon-button" aria-label="More options" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal size={19}/></button>{moreOpen && <div className="more-menu"><button onClick={() => { setMoreOpen(false); onBack(); }}>All boards</button>{user && <button onClick={() => void signOut()}>Sign out</button>}</div>}
      </div>
    </header>
    {saveError && <div className="save-error-banner" role="alert">{saveError}</div>}
    {conflictNotice && <div className="conflict-banner" role="status">{conflictNotice}<button aria-label="Dismiss notice" onClick={() => setConflictNotice('')}><X size={14}/></button></div>}
    <div className={`workspace ${readOnly ? 'viewer-workspace' : ''}`}>
      <aside className="toolbar"><div className="tool-group">{toolItems.slice(0, 2).map((item) => <ToolButton key={item.id} item={item} active={tool === item.id} onClick={() => setTool(item.id)} disabled={readOnly && item.id !== 'select' && item.id !== 'hand'} />)}</div><div className="tool-separator"/><div className="tool-group">{toolItems.slice(2, 9).map((item) => <ToolButton key={item.id} item={item} active={tool === item.id} onClick={() => setTool(item.id)} disabled={readOnly} />)}</div><div className="tool-separator"/><div className="tool-group">{toolItems.slice(9).map((item) => <ToolButton key={item.id} item={item} active={tool === item.id} onClick={() => setTool(item.id)} disabled={readOnly} />)}</div></aside>
      <section className="board-area"><Canvas readOnly={readOnly} remoteCursors={remoteCursors.filter((cursor) => collaborators.some((person) => person.userId === cursor.userId))} onCursorMove={user ? broadcastCursor : undefined}/><div className="canvas-label"><span className="label-dot"/> {readOnly ? 'View only' : user ? 'Cloud board' : 'This device'}</div><div className="bottom-controls"><div className="history-controls"><button className="control-icon" disabled={!past.length || readOnly} onClick={() => useCanvasStore.getState().undo()} title="Undo (Ctrl+Z)"><Undo2 size={17}/></button><button className="control-icon" disabled={!future.length || readOnly} onClick={() => useCanvasStore.getState().redo()} title="Redo (Ctrl+Shift+Z)"><Redo2 size={17}/></button></div><span className="control-divider"/><div className="zoom-controls"><button className="control-icon" onClick={() => changeZoom(-.1)} title="Zoom out"><ZoomOut size={17}/></button><button className="zoom-value" onClick={fit}>{Math.round(viewport.zoom * 100)}%</button><button className="control-icon" onClick={() => changeZoom(.1)} title="Zoom in"><ZoomIn size={17}/></button><button className="control-icon fit-button" onClick={fit} title="Fit to screen"><Maximize size={16}/></button></div><span className="control-divider"/><button className={`control-icon grid-toggle ${gridVisible ? 'grid-active' : ''}`} onClick={toggleGrid} title="Toggle grid"><Grid2X2 size={17}/></button></div></section>
      {!readOnly && <PropertiesPanel/>}
    </div>
  </main>;
}

function ToolButton({ item, active, onClick, disabled }: { item: typeof toolItems[number]; active: boolean; onClick: () => void; disabled?: boolean }) {
  const Icon = item.icon;
  return <button className={`tool-button ${active ? 'tool-active' : ''}`} title={`${item.label} (${item.shortcut})`} aria-label={item.label} disabled={disabled} onClick={onClick}><Icon size={18}/><span className="shortcut">{item.shortcut}</span></button>;
}
