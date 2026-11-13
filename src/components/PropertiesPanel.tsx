import { ArrowDownToLine, ArrowUpToLine, Copy, Group, Ungroup, Trash2, X } from 'lucide-react';
import { useCanvasStore } from '../stores/canvasStore';

const colors = ['#292a3a', '#6558e8', '#e76861', '#e6a23c', '#43a77a', '#438ad1'];

export default function PropertiesPanel() {
  const { elements, selectedIds, updateSelected, duplicateSelected, deleteSelected, groupSelected, ungroupSelected, moveLayer, selectElement } = useCanvasStore();
  const selected = elements.filter((item) => selectedIds.includes(item.id));
  const first = selected[0];
  const same = <K extends 'stroke' | 'fill' | 'strokeWidth' | 'opacity' | 'fontSize'>(key: K) => selected.length > 0 && selected.every((item) => item[key] === first?.[key]);
  return <aside className="properties-panel">
    <div className="panel-header"><span>{first ? selected.length > 1 ? `${selected.length} selected` : 'Properties' : 'Board'}</span>{first && <button className="panel-close" title="Deselect" onClick={() => selectElement(null)}><X size={15}/></button>}</div>
    {first ? <>
      <div className="panel-actions">
        <button title="Duplicate (Ctrl+D)" onClick={duplicateSelected}><Copy size={15}/></button>
        <button title="Bring to front" onClick={() => moveLayer('front')}><ArrowUpToLine size={15}/></button>
        <button title="Send to back" onClick={() => moveLayer('back')}><ArrowDownToLine size={15}/></button>
        <button title="Group (Ctrl+G)" disabled={selected.length < 2} onClick={groupSelected}><Group size={15}/></button>
        <button title="Ungroup (Ctrl+Shift+G)" onClick={ungroupSelected}><Ungroup size={15}/></button>
        <button title="Delete (Delete)" className="danger-action" onClick={deleteSelected}><Trash2 size={15}/></button>
      </div>
      {first.type !== 'image' && <section className="property-section"><label>{['rectangle', 'ellipse', 'diamond'].includes(first.type) ? 'Text inside shape' : 'Text content'}</label><textarea className="shape-text-input" value={first.text ?? ''} placeholder="Add text…" onFocus={() => useCanvasStore.getState().beginTransaction()} onChange={(event) => updateSelected({ text: event.target.value })} onBlur={() => useCanvasStore.getState().endTransaction()}/></section>}
      <section className="property-section"><label>Stroke</label><div className="color-options">{colors.map((color) => <button key={color} aria-label={`Stroke ${color}`} className={`swatch ${same('stroke') && first?.stroke === color ? 'swatch-selected' : ''}`} style={{ background: color }} onClick={() => updateSelected({ stroke: color })}/>) }<label className="color-picker" title="Custom stroke"><input type="color" value={first.stroke === 'transparent' ? '#ffffff' : first.stroke} onChange={(event) => updateSelected({ stroke: event.target.value })}/></label></div></section>
      <section className="property-section"><label>Fill</label><div className="color-options"><button className={`swatch no-fill ${same('fill') && first.fill === 'transparent' ? 'swatch-selected' : ''}`} aria-label="No fill" onClick={() => updateSelected({ fill: 'transparent' })}>∕</button>{colors.map((color) => <button key={color} aria-label={`Fill ${color}`} className={`swatch ${same('fill') && first.fill === color ? 'swatch-selected' : ''}`} style={{ background: color }} onClick={() => updateSelected({ fill: color })}/>)}<label className="color-picker" title="Custom fill"><input type="color" value={first.fill === 'transparent' ? '#ffffff' : first.fill} onChange={(event) => updateSelected({ fill: event.target.value })}/></label></div></section>
      <section className="property-section"><div className="property-label-row"><label>Stroke width</label><span>{same('strokeWidth') ? first.strokeWidth : '—'} px</span></div><input className="range-input" type="range" min="1" max="12" step="0.5" value={same('strokeWidth') ? first.strokeWidth : 2.5} onChange={(event) => updateSelected({ strokeWidth: Number(event.target.value) })}/></section>
      <section className="property-section"><div className="property-label-row"><label>Opacity</label><span>{same('opacity') ? Math.round((first.opacity ?? 1) * 100) : '—'}%</span></div><input className="range-input" type="range" min="0.1" max="1" step="0.05" value={same('opacity') ? first.opacity : 1} onChange={(event) => updateSelected({ opacity: Number(event.target.value) })}/></section>
      {(first.type === 'text' || first.type === 'sticky') && <section className="property-section"><div className="property-label-row"><label>Font size</label><span>{same('fontSize') ? first.fontSize ?? 20 : '—'} px</span></div><input className="range-input" type="range" min="12" max="48" step="1" value={same('fontSize') ? first.fontSize ?? 20 : 20} onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })}/><div className="format-actions"><button className={first.bold ? 'format-active' : ''} onClick={() => updateSelected({ bold: !first.bold })}><b>B</b></button><button className={first.italic ? 'format-active' : ''} onClick={() => updateSelected({ italic: !first.italic })}><i>I</i></button></div></section>}
      <div className="panel-footnote">Changes apply to all selected objects.</div>
    </> : <div className="panel-empty"><div className="panel-empty-icon">✳</div><strong>Make it yours</strong><p>Select an object to adjust its colors, size, and position in the stack.</p></div>}
  </aside>;
}
