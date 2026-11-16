import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import type { CanvasElement, Point } from '../types/canvas';

type ElementBounds = { x: number; y: number; width: number; height: number; localX: number; localY: number };
export type RemoteCursor = { userId: string; name: string; color: string; x: number; y: number };
type Gesture = { kind: 'pan' | 'draw' | 'move' | 'resize'; start: Point; origin: Point; id?: string; edge?: string; origins?: Record<string, Point>; bounds?: ElementBounds; source?: CanvasElement };
const defaults = { stroke: '#6558e8', fill: 'transparent', strokeWidth: 2.5, opacity: 1 };
const makeId = () => crypto.randomUUID();

function elementBounds(element: CanvasElement): ElementBounds {
  if (element.type === 'pencil' && element.points?.length) {
    const xs = element.points.map((point) => point.x), ys = element.points.map((point) => point.y);
    const localX = Math.min(...xs), localY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
    return { x: element.x + localX, y: element.y + localY, width: Math.max(12, maxX - localX), height: Math.max(12, maxY - localY), localX, localY };
  }
  const endX = element.x + element.width, endY = element.y + element.height;
  const x = Math.min(element.x, endX), y = Math.min(element.y, endY);
  return { x, y, width: Math.max(12, Math.abs(element.width)), height: Math.max(12, Math.abs(element.height)), localX: x - element.x, localY: y - element.y };
}

export default function Canvas({ readOnly = false, remoteCursors = [], onCursorMove }: { readOnly?: boolean; remoteCursors?: RemoteCursor[]; onCursorMove?: (point: Point) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const { viewport, setViewport, tool, gridVisible, elements, selectedIds, addElement, updateElement, deleteElement, selectElement, setTool, beginTransaction, endTransaction } = useCanvasStore();
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imagePoint, setImagePoint] = useState<Point>({ x: 80, y: 80 });
  const uploadRef = useRef<HTMLInputElement>(null);
  const pointAt = (event: { clientX: number; clientY: number }) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left - viewport.x) / viewport.zoom, y: (event.clientY - rect.top - viewport.y) / viewport.zoom };
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !hostRef.current) return;
    if (readOnly && tool !== 'hand' && !spaceDown) return;
    const target = event.target as HTMLElement;
    if (target.closest('.text-editor')) return;
    if (editingId) { endTransaction(); setEditingId(null); }
    hostRef.current.setPointerCapture(event.pointerId);
    const point = pointAt(event);
    if (tool === 'hand' || spaceDown) { setGesture({ kind: 'pan', start: { x: event.clientX, y: event.clientY }, origin: { x: viewport.x, y: viewport.y } }); return; }
    const handle = target.closest<SVGElement>('[data-handle]')?.dataset.handle;
    const targetId = target.closest<SVGElement>('[data-element-id]')?.dataset.elementId;
    if (tool === 'select' && selectedIds.length === 1 && selectedIds[0] && handle === 'resize') {
      const selected = elements.find((item) => item.id === selectedIds[0]);
      if (selected) { const bounds = elementBounds(selected); beginTransaction(); setGesture({ kind: 'resize', start: point, origin: { x: bounds.width, y: bounds.height }, id: selected.id, edge: handle, bounds, source: selected }); }
      return;
    }
    if (tool === 'select' && selectedIds.length && handle === 'move') {
      const origins = Object.fromEntries(elements.filter((item) => selectedIds.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]));
      if (Object.keys(origins).length) { beginTransaction(); setGesture({ kind: 'move', start: point, origin: { x: 0, y: 0 }, origins }); }
      return;
    }
    if (tool === 'select' && targetId) {
      const selected = elements.find((item) => item.id === targetId);
      selectElement(targetId, event.shiftKey);
      const nextIds = useCanvasStore.getState().selectedIds;
      const origins = Object.fromEntries(elements.filter((item) => nextIds.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]));
      if (selected && nextIds.includes(targetId)) { beginTransaction(); setGesture({ kind: 'move', start: point, origin: { x: 0, y: 0 }, origins }); }
      return;
    }
    if (tool === 'select') { selectElement(null); return; }
    if (tool === 'eraser') { if (targetId) deleteElement(targetId); return; }
    if (tool === 'image') { setImagePoint(point); uploadRef.current?.click(); return; }
    if (tool === 'text' || tool === 'sticky') {
      const isSticky = tool === 'sticky';
      const element: CanvasElement = { id: makeId(), type: tool, x: point.x, y: point.y, width: isSticky ? 190 : 190, height: isSticky ? 135 : 34, text: isSticky ? 'Write something…' : '', ...defaults, fill: isSticky ? '#fff1ad' : 'transparent', stroke: isSticky ? '#e6d16d' : defaults.stroke };
      beginTransaction(); addElement(element); setEditingId(element.id); if (tool === 'text') setTool('select'); return;
    }
    if (!(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'pencil'] as const).includes(tool as 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'pencil')) return;
    const type = tool as CanvasElement['type'];
    const element: CanvasElement = { id: makeId(), type, x: point.x, y: point.y, width: 0, height: 0, points: type === 'pencil' ? [{ x: 0, y: 0 }] : undefined, ...defaults };
    beginTransaction();
    addElement(element);
    setGesture({ kind: 'draw', start: point, origin: point, id: element.id });
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (onCursorMove) onCursorMove(pointAt(event));
    if (!gesture) return;
    if (gesture.kind === 'pan') { setViewport({ ...viewport, x: gesture.origin.x + event.clientX - gesture.start.x, y: gesture.origin.y + event.clientY - gesture.start.y }); return; }
    const point = pointAt(event), dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
    if (gesture.kind === 'move' && gesture.origins) Object.entries(gesture.origins).forEach(([id, origin]) => updateElement(id, { x: origin.x + dx, y: origin.y + dy }));
    if (gesture.kind === 'resize' && gesture.id) {
      const width = Math.max(12, gesture.origin.x + dx), height = Math.max(12, gesture.origin.y + dy);
      if (gesture.source?.type === 'pencil' && gesture.bounds) {
        const scaleX = width / gesture.bounds.width, scaleY = height / gesture.bounds.height;
        const points = (gesture.source.points ?? []).map((item) => ({ x: (item.x - gesture.bounds!.localX) * scaleX, y: (item.y - gesture.bounds!.localY) * scaleY }));
        updateElement(gesture.id, { x: gesture.bounds.x, y: gesture.bounds.y, width, height, points });
      } else updateElement(gesture.id, { width, height });
    }
    if (gesture.kind === 'draw' && gesture.id) {
      const current = elements.find((item) => item.id === gesture.id);
      if (current?.type === 'pencil') {
        const points = [...(current.points ?? []), { x: point.x - current.x, y: point.y - current.y }];
        updateElement(gesture.id, { width: dx, height: dy, points });
      } else if (current?.type === 'arrow' || current?.type === 'line') updateElement(gesture.id, { width: dx, height: dy });
      else updateElement(gesture.id, { x: Math.min(gesture.start.x, point.x), y: Math.min(gesture.start.y, point.y), width: Math.abs(dx), height: Math.abs(dy) });
    }
  };
  const onPointerUp = () => {
    if (gesture?.kind === 'draw' && gesture.id) {
      const drawn = useCanvasStore.getState().elements.find((item) => item.id === gesture.id);
      if (drawn && drawn.type !== 'pencil' && Math.abs(drawn.width) < 4 && Math.abs(drawn.height) < 4) deleteElement(drawn.id);
      if (drawn?.type === 'pencil' && (drawn.points?.length ?? 0) < 2) deleteElement(drawn.id);
    }
    if (gesture && gesture.kind !== 'pan') endTransaction();
    setGesture(null);
  };
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) { setViewport({ ...viewport, x: viewport.x - event.deltaX, y: viewport.y - event.deltaY }); return; }
    const rect = event.currentTarget.getBoundingClientRect(), px = event.clientX - rect.left, py = event.clientY - rect.top;
    const zoom = Math.min(3, Math.max(.2, viewport.zoom * Math.exp(-event.deltaY * .005))), ratio = zoom / viewport.zoom;
    setViewport({ zoom, x: px - (px - viewport.x) * ratio, y: py - (py - viewport.y) * ratio });
  };
  const onKeys = useCallback((event: KeyboardEvent) => {
    if (event.code === 'Space' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setSpaceDown(event.type === 'keydown'); }
  }, []);
  useEffect(() => { window.addEventListener('keydown', onKeys); window.addEventListener('keyup', onKeys); return () => { window.removeEventListener('keydown', onKeys); window.removeEventListener('keyup', onKeys); }; }, [onKeys]);
  useEffect(() => { if (editingId) editorRef.current?.focus(); }, [editingId]);
  const imageLoaded = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) { event.target.value = ''; setTool('select'); return; }
    const reader = new FileReader(); reader.onload = () => {
      const img = new Image(); img.onload = () => {
        const scale = Math.min(1, 420 / img.width, 320 / img.height);
        addElement({ id: makeId(), type: 'image', x: imagePoint.x, y: imagePoint.y, width: img.width * scale, height: img.height * scale, imageHref: String(reader.result), ...defaults, stroke: 'transparent' });
      }; img.src = String(reader.result);
    }; reader.readAsDataURL(file); event.target.value = ''; setTool('select');
  };
  const dropImage = (event: React.DragEvent<HTMLDivElement>) => {
    const file = event.dataTransfer.files[0]; if (!file?.type.startsWith('image/')) return;
    event.preventDefault(); const point = pointAt(event);
    const reader = new FileReader(); reader.onload = () => { const img = new Image(); img.onload = () => { const scale = Math.min(1, 420 / img.width, 320 / img.height); addElement({ id: makeId(), type: 'image', x: point.x, y: point.y, width: img.width * scale, height: img.height * scale, imageHref: String(reader.result), ...defaults, stroke: 'transparent' }); }; img.src = String(reader.result); }; reader.readAsDataURL(file);
  };
  const selectedItems = elements.filter((item) => selectedIds.includes(item.id));
  const editPosition = editingId ? elements.find((item) => item.id === editingId) : undefined;

  return <div ref={hostRef} className={`canvas-host ${gridVisible ? 'grid-on' : ''} ${tool === 'hand' || spaceDown ? 'cursor-grab' : ''}`} style={{ backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onDoubleClick={readOnly ? undefined : (event) => { const target = event.target as HTMLElement, id = target.closest<SVGElement>('[data-element-id]')?.dataset.elementId; if (id) { selectElement(id); beginTransaction(); setEditingId(id); } }} onDragOver={readOnly ? undefined : (event) => event.preventDefault()} onDrop={readOnly ? undefined : dropImage}>
    <svg className="scene-svg" width="100%" height="100%" aria-label="Whiteboard canvas"><defs><marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L10,5 L0,10 z" fill="#6558e8"/></marker></defs><g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
      {elements.map((item) => <SceneElement key={item.id} element={item} />)}
      {tool === 'select' && selectedItems.map((item) => <SelectionBox key={`selection-${item.id}`} element={item} resizable={selectedIds.length === 1} />)}
      {remoteCursors.map((cursor) => <g key={cursor.userId} transform={`translate(${cursor.x} ${cursor.y})`} pointerEvents="none"><path d="M0 0 L0 17 L5 12 L9 21 L13 19 L9 10 L16 10 Z" fill={cursor.color} stroke="white" strokeWidth="1.5"/><text x="18" y="15" fill="white" stroke={cursor.color} strokeWidth="5" paintOrder="stroke" fontSize="12" fontFamily="DM Sans, sans-serif">{cursor.name}</text></g>)}
    </g></svg>
    {elements.length === 0 && !gesture && <div className="starter-card"><span className="starter-icon">✳</span><h2>Your canvas is ready</h2><p>Pick a tool and start bringing your ideas to life.</p><div className="starter-hint"><kbd>Space</kbd> + drag to move around</div></div>}
    {editPosition && <input ref={editorRef} className="text-editor" style={{ left: viewport.x + editPosition.x * viewport.zoom, top: viewport.y + editPosition.y * viewport.zoom, width: Math.max(150, editPosition.width * viewport.zoom) }} value={editPosition.text ?? ''} placeholder="Type something…" onChange={(event) => updateElement(editPosition.id, { text: event.target.value })} onBlur={() => { endTransaction(); setEditingId(null); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); event.stopPropagation(); }} />}
    <input ref={uploadRef} type="file" accept="image/*" hidden onChange={imageLoaded}/>
  </div>;
}

function SceneElement({ element: item }: { element: CanvasElement }) {
  const common = { 'data-element-id': item.id, stroke: item.stroke, strokeWidth: item.strokeWidth, fill: item.fill, opacity: item.opacity, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const width = item.width, height = item.height;
  return <g data-element-id={item.id} transform={`translate(${item.x} ${item.y})`} style={{ cursor: 'move' }}>
    {item.type === 'rectangle' && <rect {...common} width={width} height={height} rx="4"/>}
    {item.type === 'ellipse' && <ellipse {...common} cx={width / 2} cy={height / 2} rx={Math.abs(width / 2)} ry={Math.abs(height / 2)}/>}
    {item.type === 'diamond' && <polygon {...common} points={`${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`}/>}
    {(item.type === 'line' || item.type === 'arrow') && <line {...common} x1="0" y1="0" x2={width} y2={height} fill="none" markerEnd={item.type === 'arrow' ? 'url(#arrowhead)' : undefined}/>}
    {item.type === 'pencil' && <polyline {...common} points={(item.points ?? []).map((point) => `${point.x},${point.y}`).join(' ')} fill="none"/>}
    {item.type === 'sticky' && <><rect {...common} width={width} height={height} rx="5"/><text x="12" y="25" fill="#5e5639" fontSize={item.fontSize ?? 14} fontWeight={item.bold ? 700 : 400} fontStyle={item.italic ? 'italic' : 'normal'} fontFamily="DM Sans, sans-serif" pointerEvents="none">{item.text}</text></>}
    {item.type === 'text' && <><rect className="text-box-boundary" x="0" y="0" width={width} height={height} fill="#6558e8" fillOpacity=".025" stroke="#6558e8" strokeOpacity=".28" strokeDasharray="3 4"/><text x="8" y="25" fill={item.stroke} fontSize={item.fontSize ?? 20} fontWeight={item.bold ? 700 : 400} fontStyle={item.italic ? 'italic' : 'normal'} fontFamily="DM Sans, sans-serif" pointerEvents="none">{item.text}</text></>}
    {['rectangle', 'ellipse', 'diamond'].includes(item.type) && item.text && <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" fill={item.stroke} fontSize={item.fontSize ?? 16} fontWeight={item.bold ? 700 : 400} fontStyle={item.italic ? 'italic' : 'normal'} fontFamily="DM Sans, sans-serif" pointerEvents="none">{item.text}</text>}
    {item.type === 'image' && item.imageHref && <image href={item.imageHref} width={width} height={height} preserveAspectRatio="xMidYMid meet"/>}
  </g>;
}

function SelectionBox({ element, resizable }: { element: CanvasElement; resizable: boolean }) {
  const bounds = elementBounds(element), width = bounds.width, height = bounds.height;
  return <g transform={`translate(${bounds.x} ${bounds.y})`} pointerEvents="all">
    <rect x={-5} y={-5} width={width + 10} height={height + 10} fill="transparent" stroke="transparent" data-handle="move"/>
    <rect x={-5} y={-5} width={width + 10} height={height + 10} fill="none" stroke="#6558e8" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
    {resizable && <circle cx={width} cy={height} r="5" fill="white" stroke="#6558e8" strokeWidth="1.5" data-handle="resize" style={{ cursor: 'nwse-resize' }}/>}
  </g>;
}
