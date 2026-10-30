import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Match } from "effect";
import { z } from "zod";

const PanelSizes = z.object({ left: z.number().min(180).max(420), right: z.number().min(220).max(480) });

const defaults = { left: 248, right: 320 };

const storageKey = "camenae.panel-widths";

export type Side = "left" | "right";

interface Drag {
  side: Side;
  x: number;
  value: number;
}

const stored = () => {
  try { return PanelSizes.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null")); }
  catch { return defaults; }
};

// The storage key and limits predate the Solid shell, so a remembered width survives upgrades.
export function createPanelSizes() {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const [width, setWidth] = createSignal(window.innerWidth);
  const [preferred, setPreferred] = createSignal(stored());
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const minimum = { left: 180, right: 220 };
  const left = createMemo(() => Math.max(180, Math.min(preferred().left, width() - 320 - (width() >= 1000 ? 236 : 8))));
  const right = createMemo(() => Math.max(220, Math.min(preferred().right, width() - left() - 336)));

  const maximum = createMemo(() => ({
    left: Math.max(180, Math.min(420, width() - 320 - (width() >= 1000 ? right() + 16 : 8))),
    right: Math.max(220, Math.min(480, width() - left() - 336)),
  }));

  createEffect(() => {
    const element = container();

    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const value = preferred();

    try { localStorage.setItem(storageKey, JSON.stringify(value)); }
    catch { /* Browser storage is optional; dragging still works without it. */ }
  });

  const resize = (side: Side, value: number) => setPreferred((current) => ({ ...current,
    [side]: Math.max(minimum[side], Math.min(maximum()[side], Math.round(value))) }));

  const keyboard = (side: Side, event: KeyboardEvent) => {
    const value = side === "left" ? left() : right();
    const step = event.shiftKey ? 32 : 8;
    const direction = side === "left" ? 1 : -1;

    const next = Match.value(event.key).pipe(
      Match.when("Home", () => minimum[side]), Match.when("End", () => maximum()[side]),
      Match.when("ArrowLeft", () => value - step * direction), Match.when("ArrowRight", () => value + step * direction),
      Match.orElse(() => undefined),
    );

    if (next === undefined) return;
    event.preventDefault();
    resize(side, next);
  };

  const pointerDown = (side: Side, event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ side, x: event.clientX, value: side === "left" ? left() : right() });
  };

  const pointerMove = (event: PointerEvent) => {
    const current = drag();

    if (current) resize(current.side, current.value + (event.clientX - current.x) * (current.side === "left" ? 1 : -1));
  };

  const columns = () => width() >= 1000 ? `${left()}px 8px minmax(0, 1fr) 8px ${right()}px`
    : width() >= 700 ? `${left()}px 8px minmax(0, 1fr)` : undefined;

  return { setContainer, left, right, maximum, minimum, dragging: () => drag() !== null, keyboard, pointerDown, pointerMove,
    endDrag: () => setDrag(null), reset: (side: Side) => resize(side, defaults[side]), columns };
}
