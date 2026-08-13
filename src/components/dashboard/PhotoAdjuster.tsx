import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

/**
 * Framing a profile photo by hand: drag to move, pinch or scroll to zoom,
 * rotate in quarter turns. What sits inside the circle is exactly what gets
 * saved — a square JPEG cut from the original at full quality, so a wide
 * holiday photo can still become a decent portrait.
 */

const FRAME = 260; // on-screen size of the crop window
const OUTPUT = 512; // saved image size, in pixels
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export default function PhotoAdjuster({
  file,
  busy = false,
  onCancel,
  onConfirm,
}: {
  /** The picture being framed: a freshly picked file or an existing URL. */
  file: File | string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [quarterTurns, setTurns] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* ------------------------------------------------------------- loading */
  useEffect(() => {
    let url: string | null = null;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => { setImg(el); setError(null); };
    el.onerror = () => setError("That image could not be opened.");
    if (typeof file === "string") el.src = file;
    else { url = URL.createObjectURL(file); el.src = url; }
    setZoom(1); setTurns(0); setOffset({ x: 0, y: 0 });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);

  /** Turning the photo swaps its width and height. */
  const rotated = quarterTurns % 2 === 1;
  const natW = img ? (rotated ? img.naturalHeight : img.naturalWidth) : 0;
  const natH = img ? (rotated ? img.naturalWidth : img.naturalHeight) : 0;
  /** Smallest scale that still fills the circle. */
  const baseScale = natW && natH ? FRAME / Math.min(natW, natH) : 1;

  /** Never let the photo pull away from the edge of the frame. */
  const clampOffset = useCallback((o: { x: number; y: number }, z: number) => {
    const w = natW * baseScale * z;
    const h = natH * baseScale * z;
    const mx = Math.max(0, (w - FRAME) / 2);
    const my = Math.max(0, (h - FRAME) / 2);
    return { x: clamp(o.x, -mx, mx), y: clamp(o.y, -my, my) };
  }, [natW, natH, baseScale]);

  useEffect(() => { setOffset((o) => clampOffset(o, zoom)); }, [clampOffset, zoom]);

  /* ---------------------------------------------------------- the canvas */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = FRAME * dpr;
    canvas.height = FRAME * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, FRAME, FRAME);
    drawFramed(ctx, img, { size: FRAME, zoom, offset, quarterTurns, baseScale });
  }, [img, zoom, offset, quarterTurns, baseScale]);

  /* ------------------------------------------------------------ gestures */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) {
        const next = clamp(pinch.current.zoom * (dist / pinch.current.dist), MIN_ZOOM, MAX_ZOOM);
        setZoom(next);
        setOffset((o) => clampOffset(o, next));
      }
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, zoom));
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  // React's onWheel is passive, so the page would scroll behind the frame.
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandler.current = (e: WheelEvent) => {
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
    const next = clamp(zoom * Math.exp(-dy * 0.0015), MIN_ZOOM, MAX_ZOOM);
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Keep whatever is under the cursor exactly where it is.
    const px = e.clientX - rect.left - FRAME / 2;
    const py = e.clientY - rect.top - FRAME / 2;
    const k = next / zoom;
    setZoom(next);
    setOffset((o) => clampOffset({ x: px - (px - o.x) * k, y: py - (py - o.y) * k }, next));
  };

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); wheelHandler.current(e); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* -------------------------------------------------------------- saving */
  const confirm = () => {
    if (!img) return;
    const out = document.createElement("canvas");
    out.width = OUTPUT;
    out.height = OUTPUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const k = OUTPUT / FRAME;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawFramed(ctx, img, { size: FRAME, zoom, offset, quarterTurns, baseScale });
    out.toBlob((blob) => { if (blob) onConfirm(blob); }, "image/jpeg", 0.92);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        <div
          ref={frameRef}
          style={{ width: FRAME, height: FRAME, touchAction: "none" }}
          className="relative select-none overflow-hidden rounded-full border border-border bg-muted shadow-inner cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          <canvas ref={canvasRef} style={{ width: FRAME, height: FRAME }} className="block" />
          {!img && !error && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-destructive">{error}</div>
          )}
          {/* A faint guide showing where the photo will be cut. */}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-foreground/15" />
        </div>

        <p className="text-xs text-muted-foreground">Drag to move · pinch or scroll to zoom</p>

        <div className="flex w-full max-w-[300px] items-center gap-3">
          <ZoomOut className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Slider
            value={[zoom]}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            onValueChange={([v]) => { setZoom(v); setOffset((o) => clampOffset(o, v)); }}
            aria-label="Zoom"
          />
          <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setTurns((t) => (t + 1) % 4)} disabled={!img}>
            <RotateCw className="mr-2 h-4 w-4" /> Rotate
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); setTurns(0); }}
            disabled={!img}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button className="flex-1" onClick={confirm} disabled={!img || busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {busy ? "Saving…" : "Use this photo"}
        </Button>
      </div>
    </div>
  );
}

/** Paint the photo into a square of `size`, honouring zoom, pan and rotation. */
function drawFramed(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  o: { size: number; zoom: number; offset: { x: number; y: number }; quarterTurns: number; baseScale: number },
) {
  const { size, zoom, offset, quarterTurns, baseScale } = o;
  ctx.save();
  ctx.translate(size / 2 + offset.x, size / 2 + offset.y);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  const s = baseScale * zoom;
  ctx.drawImage(
    img,
    (-img.naturalWidth * s) / 2,
    (-img.naturalHeight * s) / 2,
    img.naturalWidth * s,
    img.naturalHeight * s,
  );
  ctx.restore();
}
