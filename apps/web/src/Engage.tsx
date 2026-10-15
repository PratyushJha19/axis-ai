import { useEffect, useRef, useState } from "react";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Animates a number from its previous value to the next one. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value),
    from = useRef(value);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now(),
      origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 700),
        eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}</>;
}

export function ProgressRing({
  value,
  size = 120,
  stroke = 10,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2,
    c = 2 * Math.PI * r,
    pct = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7aa7ff" />
            <stop offset="55%" stopColor="#b48cff" />
            <stop offset="100%" stopColor="#ff8ac6" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="ring-track"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="ring-value"
          stroke="url(#ring-gradient)"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

const cheers = [
  "Boom. Done.",
  "Crushed it!",
  "One less thing.",
  "Momentum unlocked.",
  "Look at you go.",
  "Checked off. Nice.",
  "That felt good.",
];
export const cheer = () => cheers[Math.floor(Math.random() * cheers.length)]!;

const confettiColors = ["#7aa7ff", "#b48cff", "#ff8ac6", "#ffd36e", "#6ee7c8"];
/** Short decorative particle burst from an element; skipped for reduced motion. */
export function burst(from: Element | null) {
  if (!from || reducedMotion()) return;
  const rect = from.getBoundingClientRect(),
    x = rect.left + rect.width / 2,
    y = rect.top + rect.height / 2;
  for (let i = 0; i < 26; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.setAttribute("aria-hidden", "true");
    const angle = Math.random() * Math.PI * 2,
      distance = 40 + Math.random() * 90;
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.background = confettiColors[i % confettiColors.length]!;
    piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--dy", `${Math.sin(angle) * distance - 30}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 900);
  }
}

/** Human countdown such as "in 2h 15m" or "5m overdue". */
export function timeUntil(iso: string, now: number) {
  const diff = Date.parse(iso) - now,
    abs = Math.abs(diff),
    m = Math.round(abs / 60000);
  const text =
    m < 1
      ? "now"
      : m < 60
        ? `${m}m`
        : m < 60 * 24
          ? `${Math.floor(m / 60)}h ${m % 60}m`
          : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (text === "now") return { text: "due now", tone: "hot" as const };
  if (diff < 0) return { text: `${text} overdue`, tone: "late" as const };
  return {
    text: `in ${text}`,
    tone:
      m <= 60
        ? ("hot" as const)
        : m <= 60 * 24
          ? ("warm" as const)
          : ("calm" as const),
  };
}

/** Re-renders every minute so countdowns stay fresh. */
export function useNow(interval = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}

/** Stable accent hue per record, so each project keeps its colour. */
export function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
