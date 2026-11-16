export type Point = { x: number; y: number };
export type Tool = 'select' | 'hand' | 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'pencil' | 'text' | 'sticky' | 'image' | 'eraser';
export type Viewport = { x: number; y: number; zoom: number };
export type ElementType = Exclude<Tool, 'select' | 'hand' | 'eraser' | 'image'> | 'image';
export type CanvasElement = {
  id: string; type: ElementType; x: number; y: number; width: number; height: number;
  points?: Point[]; text?: string; imageHref?: string;
  stroke: string; fill: string; strokeWidth: number; opacity: number;
  fontSize?: number; bold?: boolean; italic?: boolean; groupId?: string;
};
