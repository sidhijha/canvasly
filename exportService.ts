import type { CanvasElement } from '../types/canvas';

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const safeName = (title: string) => (title.trim() || 'canvasly-board').replace(/[<>:"/\\|?*]+/g, '-');

export async function exportJson(title: string, elements: CanvasElement[]) {
  const embedded = await Promise.all(elements.map(async (element) => {
    if (!element.imageHref || element.imageHref.startsWith('data:')) return element;
    try {
      const response = await fetch(element.imageHref); if (!response.ok) return element;
      const blob = await response.blob();
      const imageHref = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
      return { ...element, imageHref };
    } catch { return element; }
  }));
  const body = JSON.stringify({ format: 'canvasly-board', version: 1, title, exportedAt: new Date().toISOString(), elements: embedded }, null, 2);
  download(new Blob([body], { type: 'application/json' }), `${safeName(title)}.json`);
}

function sceneBounds(elements: CanvasElement[]) {
  if (!elements.length) return { x: 0, y: 0, width: 960, height: 640 };
  const xs = elements.flatMap((item) => [item.x, item.x + item.width]);
  const ys = elements.flatMap((item) => [item.y, item.y + item.height]);
  const padding = 32, x = Math.min(...xs) - padding, y = Math.min(...ys) - padding;
  return { x, y, width: Math.max(1, Math.max(...xs) - Math.min(...xs) + padding * 2), height: Math.max(1, Math.max(...ys) - Math.min(...ys) + padding * 2) };
}

async function svgBlob(elements: CanvasElement[]): Promise<{ blob: Blob; width: number; height: number }> {
  const source = document.querySelector('.scene-svg');
  if (!(source instanceof SVGSVGElement)) throw new Error('The canvas is not ready to export.');
  const clone = source.cloneNode(true) as SVGSVGElement;
  const bounds = sceneBounds(elements);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  clone.setAttribute('width', String(Math.ceil(bounds.width))); clone.setAttribute('height', String(Math.ceil(bounds.height)));
  const scene = clone.querySelector(':scope > g'); scene?.removeAttribute('transform');
  clone.querySelectorAll('[data-handle], [stroke-dasharray]').forEach((node) => node.remove());
  const images = [...clone.querySelectorAll('image')];
  await Promise.all(images.map(async (image) => {
    const href = image.getAttribute('href');
    if (!href || href.startsWith('data:')) return;
    try { const response = await fetch(href); if (!response.ok) return; const blob = await response.blob(); const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); image.setAttribute('href', data); }
    catch { /* The vector remains exportable if a remote image cannot be embedded. */ }
  }));
  const xml = new XMLSerializer().serializeToString(clone);
  return { blob: new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
}

export async function exportSvg(title: string, elements: CanvasElement[]) {
  const { blob } = await svgBlob(elements); download(blob, `${safeName(title)}.svg`);
}

export async function exportPng(title: string, elements: CanvasElement[]) {
  const { blob, width, height } = await svgBlob(elements), image = new Image();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render the board as an image.')); image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('PNG export is unavailable in this browser.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode the PNG file.')), 'image/png'));
    download(png, `${safeName(title)}.png`);
  } finally { URL.revokeObjectURL(url); }
}

export function readBoardFile(file: File): Promise<{ title?: string; elements: CanvasElement[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(reader.error ?? new Error('Could not read this file.'));
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { format?: string; version?: number; title?: string; elements?: unknown };
        if (!Array.isArray(parsed.elements) || parsed.format && parsed.format !== 'canvasly-board') throw new Error('This file is not a valid Canvasly board.');
        const elements = parsed.elements as CanvasElement[];
        if (elements.some((item) => !item || typeof item.id !== 'string' || typeof item.type !== 'string' || !Number.isFinite(item.x) || !Number.isFinite(item.y))) throw new Error('The board file contains invalid elements.');
        resolve({ title: parsed.title, elements });
      } catch (error) { reject(error instanceof Error ? error : new Error('Could not parse this board file.')); }
    };
    reader.readAsText(file);
  });
}
