import { useEffect, useRef, useState } from "react";

/**
 * One shared tooltip for the page. Any element with a `data-tip` attribute gets
 * it on hover and on keyboard focus.
 */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = (e: Event) => {
      const target = (e.target as Element).closest?.("[data-tip]");
      if (!target) return setTip(null);
      const box = target.getBoundingClientRect();
      setTip({
        text: target.getAttribute("data-tip") ?? "",
        x: box.left + box.width / 2,
        y: box.top,
      });
    };
    const hide = () => setTip(null);
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide);
    };
  }, []);

  if (!tip) return null;
  const width = ref.current?.offsetWidth ?? 180;
  const left = Math.min(Math.max(8, tip.x - width / 2), window.innerWidth - width - 8);
  return (
    <div ref={ref} className="tooltip" style={{ left, top: tip.y - 8 }}>
      {tip.text}
    </div>
  );
}
