import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useWinterSeason } from "@/lib/winterSeason";
import "./winterWorkspace.css";

// Stable positions and negative delays avoid random re-renders and start-up bursts.
const flakes = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 37 + 7) % 98,
  size: 2 + (i % 3),
  duration: 19 + (i * 3) % 13,
  delay: -((i * 7 + 3) % 26),
  drift: i % 2 ? 24 : -24,
}));

export function WinterSnow() {
  const active = useWinterSeason();
  if (!active || typeof document === "undefined") return null;
  return createPortal(
    <div className="hc-winter-snow" aria-hidden="true">
      {flakes.map((flake, i) => (
        <span
          key={i}
          className="hc-winter-flake"
          style={{
            left: `${flake.left}%`,
            width: flake.size,
            height: flake.size,
            animationDuration: `${flake.duration}s`,
            animationDelay: `${flake.delay}s`,
            "--hc-winter-drift": `${flake.drift}px`,
          } as CSSProperties}
        />
      ))}
    </div>,
    document.body,
  );
}

export function WinterLogoHat() {
  const active = useWinterSeason();
  if (!active) return null;
  return (
    <svg className="hc-winter-hat" viewBox="0 0 28 25" aria-hidden="true" focusable="false">
      <path d="M5 17C7 6 13 2 19 4c3 1 4 4 5 8l-5-2-1 7Z" fill="#dc2626" stroke="#991b1b" strokeWidth="0.7" />
      <path d="M6 17c4-2 9-2 13 0 1 .5 1 4-1 4H5c-2 0-2-3 1-4Z" fill="#fff" stroke="#cbd5e1" strokeWidth="0.7" />
      <circle cx="24" cy="12" r="3" fill="#fff" stroke="#cbd5e1" strokeWidth="0.7" />
    </svg>
  );
}
