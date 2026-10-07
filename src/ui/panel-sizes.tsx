import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { z } from "zod";
import { Match } from "effect";

const PanelSizes = z.object({ left: z.number().min(180).max(420), right: z.number().min(220).max(480) });

const defaults = { left: 248, right: 320 };

type Side = "left" | "right";

export function usePanelSizes() {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => typeof window === "undefined" ? 1440 : window.innerWidth);

  const [preferred, setPreferred] = useState(() => {
    try { return PanelSizes.parse(JSON.parse(localStorage.getItem("camenae.panel-widths") ?? "null")); }
    catch { return defaults; }
  });

  const [drag, setDrag] = useState<{ side: Side; x: number; value: number } | null>(null);
  const left = Math.max(180, Math.min(preferred.left, width - 320 - (width >= 1000 ? 236 : 8)));
  const right = Math.max(220, Math.min(preferred.right, width - left - 336));
  const maximum = { left: Math.max(180, Math.min(420, width - 320 - (width >= 1000 ? right + 16 : 8))), right: Math.max(220, Math.min(480, width - left - 336)) };
  const minimum = { left: 180, right: 220 };

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(container.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try { localStorage.setItem("camenae.panel-widths", JSON.stringify(preferred)); }
    catch { /* Browser storage is optional; dragging still works without it. */ }
  }, [preferred]);

  const resize = (side: Side, value: number) => setPreferred((current) => ({ ...current,
    [side]: Math.max(minimum[side], Math.min(maximum[side], Math.round(value))) }));

  const keyboard = (side: Side, event: KeyboardEvent<HTMLDivElement>) => {
    const value = side === "left" ? left : right;
    const step = event.shiftKey ? 32 : 8;
    const direction = side === "left" ? 1 : -1;

    const next = Match.value(event.key).pipe(
      Match.when("Home", () => minimum[side]), Match.when("End", () => maximum[side]),
      Match.when("ArrowLeft", () => value - step * direction), Match.when("ArrowRight", () => value + step * direction),
      Match.orElse(() => undefined),
    );

    if (next === undefined) return;
    event.preventDefault(); resize(side, next);
  };

  const pointerDown = (side: Side, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ side, x: event.clientX, value: side === "left" ? left : right });
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) resize(drag.side, drag.value + (event.clientX - drag.x) * (drag.side === "left" ? 1 : -1));
  };

  return { container, left, right, maximum, minimum, dragging: drag !== null, keyboard, pointerDown, pointerMove,
    endDrag: () => setDrag(null), reset: (side: Side) => resize(side, defaults[side]),
    columns: width >= 1000 ? `${left}px 8px minmax(0, 1fr) 8px ${right}px` : width >= 700 ? `${left}px 8px minmax(0, 1fr)` : undefined };
}
