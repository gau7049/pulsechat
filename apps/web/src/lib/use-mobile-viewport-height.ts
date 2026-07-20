import { useEffect, useState } from 'react';

/**
 * On mobile, an on-screen keyboard shrinks the *visual* viewport but not the
 * layout viewport that `dvh` is based on (most notably iOS Safari — `dvh`
 * only reacts to the browser chrome showing/hiding, never the keyboard). A
 * `dvh`-sized container that doesn't shrink with the keyboard ends up with
 * its bottom (here, the message composer) hidden behind the keyboard, which
 * triggers the browser's own "scroll the focused input into view" behavior —
 * dragging the whole page, including anything sticky, up with it. Tracking
 * `window.visualViewport` directly and feeding it back in as an explicit
 * pixel height keeps the container already correctly sized, so that native
 * correction never has a reason to fire.
 *
 * Returns `undefined` at/above the `lg` breakpoint so callers can fall back
 * to their normal desktop sizing (`lg:h-dvh` etc.) — desktop has no
 * on-screen keyboard to compensate for.
 */
export function useMobileViewportHeightPx(): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const vv = window.visualViewport;
    const desktop = window.matchMedia('(min-width: 1024px)');

    function update() {
      if (desktop.matches) {
        setHeight(undefined);
        return;
      }
      setHeight(vv?.height ?? window.innerHeight);
    }

    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    desktop.addEventListener('change', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      desktop.removeEventListener('change', update);
    };
  }, []);

  return height;
}
