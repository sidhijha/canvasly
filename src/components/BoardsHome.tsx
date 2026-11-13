import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { FilePlus2, MoreHorizontal, Plus, Sparkles, Users, X } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { createBoard, deleteBoard, listBoards, renameBoard, type BoardSummary } from '../services/boardService';

export default function BoardsHome({ user, onOpen, onSignOut, onGuest, initialError = '' }: { user: User | null; onOpen: (board: BoardSummary) => void; onSignOut: () => void; onGuest: () => void; initialError?: string }) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(initialError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { setBoards(await listBoards(user)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load boards.'); } finally { setLoading(false); } }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);
  const create = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { const board = await createBoard(title.trim() || 'Untitled board', user); setCreating(false); setTitle(''); onOpen(board); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create board.'); } finally { setBusy(false); } };
  const rename = async (board: BoardSummary) => { const next = window.prompt('Rename board', board.title); if (!next?.trim()) return; try { await renameBoard(board.id, next.trim()); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not rename board.'); } };
  const remove = async (board: BoardSummary) => { if (!window.confirm(`Delete “${board.title}”? This cannot be undone.`)) return; try { await deleteBoard(board.id); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete board.'); } };
  return <main className="boards-home"><header className="home-nav"><div className="auth-brand"><div className="brand-mark"><Sparkles size={18}/></div><span>canvasly</span></div><div className="home-user"><span>{user?.user_metadata.display_name || user?.email || 'Guest workspace'}</span>{user ? <button className="home-signout" onClick={onSignOut}>Sign out</button> : <button className="home-signout" onClick={onGuest}>Sign in</button>}</div></header>
    <section className="boards-content"><div className="boards-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Your boards</h1><p>Pick up where you left off, or start with a blank canvas.</p></div><button className="button button-primary create-board" onClick={() => setCreating(true)}><Plus size={16}/> New board</button></div>
      {error && <div className="board-error"><span>{error}</span><button onClick={() => setError('')}><X size={14}/></button></div>}
      {loading ? <div className="boards-loading">Loading your boards…</div> : boards.length ? <div className="board-grid">{boards.map((board, index) => <article key={board.id} className="board-card"><button className={`board-preview preview-${index % 5}`} onClick={() => onOpen(board)} aria-label={`Open ${board.title}`}><span className="preview-spark">✳</span><span className="preview-lines"><i/><i/><i/></span></button><div className="board-card-meta"><button className="board-card-title" onClick={() => onOpen(board)}>{board.title}</button><button className="board-menu" title="Board actions" onClick={() => { const action = window.prompt('Type rename or delete', 'rename'); if (action?.toLowerCase() === 'rename') void rename(board); if (action?.toLowerCase() === 'delete') void remove(board); }}><MoreHorizontal size={18}/></button><span className="board-updated">Edited {new Date(board.updated_at).toLocaleDateString()}</span></div></article>)}</div> : <div className="boards-empty"><div className="empty-icon"><FilePlus2 size={22}/></div><h2>Your first board starts here</h2><p>Create a board to sketch an idea, map a process, or plan something together.</p><button className="button button-primary" onClick={() => setCreating(true)}><Plus size={16}/> Create your first board</button></div>}
      {user && <div className="home-note"><Users size={15}/> Boards shared with your account will appear here.</div>}
    </section>
    {creating && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><form className="create-modal" onSubmit={create}><button type="button" className="modal-close" onClick={() => setCreating(false)}><X size={17}/></button><h2>New board</h2><p>Give your canvas a name. You can change it any time.</p><label>Board name<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Untitled board" maxLength={80}/></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create board'}</button></div></form></div>}
  </main>;
}
