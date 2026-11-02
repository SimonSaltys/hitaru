import { useLayoutEffect, useRef, useState } from "react";

/** Tracks an element's width so SVG charts draw at real pixels, keeping text one size. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
