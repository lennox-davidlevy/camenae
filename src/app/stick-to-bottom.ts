import { createSignal, onCleanup } from "solid-js";

// How close to the bottom still counts as "following" the conversation.
const followDistance = 80;

// How long a wheel, touch, or key press still counts as the reader scrolling.
const intentWindow = 500;

// Chat scrolling: while you are at (or near) the bottom, new content keeps you
// there; once you scroll up to read, nothing moves and `unseen` says new
// content arrived below. Sending, opening a conversation or `jump` follow again.
export function createStickToBottom() {
  const [unseen, setUnseen] = createSignal(false);
  let element: HTMLElement | undefined;
  let following = true;
  let height = 0;
  let top = 0;
  let intent = -Infinity;
  let pointerDown = false;
  let observer: MutationObserver | undefined;
  let resizes: ResizeObserver | undefined;
  let frame = 0;

  const distance = () => element ? element.scrollHeight - element.scrollTop - element.clientHeight : 0;

  const toBottom = (behavior: ScrollBehavior = "auto") => {
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    following = true;
    setUnseen(false);
  };

  // Content changes arrive in bursts (a streamed reply); settle once per frame.
  const changed = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!element || element.scrollHeight === height) return;
      const grew = element.scrollHeight > height;
      // Where the reader was before this content: a scroll in the same frame
      // may not have reported yet.
      following = following && height - element.scrollTop - element.clientHeight <= followDistance;
      height = element.scrollHeight;

      if (following) toBottom();
      else if (grew) setUnseen(true);
    });
  };

  // Only the reader moving up stops following: content arriving below never
  // moves the scroll position, though a late scroll event can see it.
  const scrolled = () => {
    if (!element) return;
    const near = distance() <= followDistance;
    // The browser also lowers scrollTop when content shrinks or the view grows taller, and may
    // report that late. Only a scroll the reader just asked for stops following.
    const reader = pointerDown || performance.now() - intent < intentWindow;

    if (near) following = true;
    else if (reader && element.scrollTop < top - 1) following = false;
    top = element.scrollTop;

    if (following && near) setUnseen(false);
  };

  const markIntent = () => { intent = performance.now(); };

  const pressed = () => { pointerDown = true; };

  const released = () => { pointerDown = false; };

  const ref = (value: HTMLElement) => {
    element = value;
    height = value.scrollHeight;
    value.addEventListener("scroll", scrolled, { passive: true });

    for (const type of ["wheel", "touchstart", "touchmove", "keydown"]) value.addEventListener(type, markIntent, { passive: true });
    value.addEventListener("pointerdown", pressed, { passive: true });
    window.addEventListener("pointerup", released, { passive: true });
    window.addEventListener("pointercancel", released, { passive: true });
    observer = new MutationObserver(changed);
    observer.observe(value, { childList: true, subtree: true, characterData: true });
    // The view itself changes size too (the composer appearing, a window
    // resize): a follower stays at the bottom.
    resizes = new ResizeObserver(() => { if (following) toBottom(); });
    resizes.observe(value);
    requestAnimationFrame(() => toBottom());
  };

  onCleanup(() => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    resizes?.disconnect();
    element?.removeEventListener("scroll", scrolled);

    for (const type of ["wheel", "touchstart", "touchmove", "keydown"]) element?.removeEventListener(type, markIntent);
    element?.removeEventListener("pointerdown", pressed);
    window.removeEventListener("pointerup", released);
    window.removeEventListener("pointercancel", released);
  });

  return { ref, unseen, jump: () => toBottom("smooth"), follow: () => toBottom() };
}
