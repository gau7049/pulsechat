import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { STICKERS } from '../chat/stickers';

const PEN_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#000000'];
/** Caps canvas resolution — uploadAttachment compresses further regardless. */
const MAX_DIMENSION = 1600;

export interface ImageAnnotatorProps {
  file: File;
  onDone: (file: File) => void;
  onCancel: () => void;
}

type Tool = { kind: 'pen'; color: string } | { kind: 'sticker'; emoji: string };

/**
 * Client-side image annotation (Requirement Scope §11, §14.4): freehand
 * drawing + emoji stickers on a photo before it's sent, shared between the
 * status composer and chat image attachments.
 */
export function ImageAnnotator({ file, onDone, onCancel }: ImageAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<Tool>({ kind: 'pen', color: PEN_COLORS[0]! });
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      setReady(true);
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pushHistory(): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > 20) historyRef.current.shift();
    setCanUndo(true);
  }

  function undo(): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const last = historyRef.current.pop();
    if (!canvas || !ctx || !last) return;
    ctx.putImageData(last, 0, 0);
    setCanUndo(historyRef.current.length > 0);
  }

  function toCanvasPoint(event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>): void {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const point = toCanvasPoint(event);
    if (tool.kind === 'sticker') {
      pushHistory();
      ctx.font = '64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tool.emoji, point.x, point.y);
      return;
    }
    pushHistory();
    drawingRef.current = true;
    lastPointRef.current = point;
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current || tool.kind !== 'pen') return;
    const ctx = canvasRef.current?.getContext('2d');
    const last = lastPointRef.current;
    if (!ctx || !last) return;
    const point = toCanvasPoint(event);
    ctx.strokeStyle = tool.color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function handlePointerUp(): void {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function handleDone(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    canvas.toBlob(
      (blob) => {
        if (blob) onDone(new File([blob], file.name, { type: blob.type || file.type }));
      },
      mime,
      0.92,
    );
  }

  return (
    <Modal open onClose={onCancel} title="Edit photo">
      <div className="flex max-h-[70vh] flex-col gap-3">
        <div className="flex items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-sunken">
          <canvas
            ref={canvasRef}
            className="max-h-[50vh] max-w-full touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PEN_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Draw in ${color}`}
              aria-pressed={tool.kind === 'pen' && tool.color === color}
              onClick={() => setTool({ kind: 'pen', color })}
              style={{ background: color }}
              className={`size-7 rounded-full border-2 ${
                tool.kind === 'pen' && tool.color === color ? 'border-accent' : 'border-border'
              }`}
            />
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={undo} disabled={!canUndo}>
            Undo
          </Button>
        </div>

        <div className="flex flex-wrap gap-1">
          {STICKERS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Place ${emoji} sticker`}
              aria-pressed={tool.kind === 'sticker' && tool.emoji === emoji}
              onClick={() => setTool({ kind: 'sticker', emoji })}
              className={`rounded-lg p-1 text-xl hover:bg-surface-sunken ${
                tool.kind === 'sticker' && tool.emoji === emoji ? 'bg-accent-soft' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleDone} disabled={!ready}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
