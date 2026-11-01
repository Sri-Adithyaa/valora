/** Minimal inline stroke icon set (no icon-font / CDN dependency). */
const PATHS = {
  "check-circle": "M9 12.5l2 2 4-4.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 8v5m0 3.5v.01M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 11v5m0-8.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  x: "M6 6l12 12M18 6L6 18",
  bell: "M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9",
  menu: "M4 7h16M4 12h16M4 17h16",
  swap: "M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3",
  "swap-h": "M4 7h14m0 0l-3-3m3 3l-3 3M20 17H6m0 0l3-3m-3 3l3 3",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3l-4.35-4.35",
  star: "M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z",
  "arrow-up-right": "M7 17L17 7m0 0H9m8 0v8",
  "arrow-right": "M5 12h14m0 0l-5-5m5 5l-5 5",
  "arrow-left": "M19 12H5m0 0l5-5m-5 5l5 5",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-right": "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  logout: "M15 17l5-5-5-5m5 5H9m4 9H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8",
  wallet: "M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2M3 7.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7.5A1.5 1.5 0 0 0 4.5 9H20v4m0 0h-4a1.5 1.5 0 0 0 0 3h4",
  chart: "M4 19h16M6 15l4-4 3 3 5-6",
  candle: "M7 4v3m0 8v5M17 4v6m0 6v4M5 7h4v8H5zM15 10h4v6h-4z",
  line: "M3 17l5-6 4 3 4-6 5 4",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 5v3h3m-3 5a8 8 0 0 0 14.9 3M20 19v-3h-3",
  shield: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  external: "M14 4h6v6m0-6L10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  layers: "M12 3l9 5-9 5-9-5zm-9 9l9 5 9-5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0 0c2.5-2.5 3.5-5.5 3.5-9S14.5 5.5 12 3m0 18c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3M3.5 9h17M3.5 15h17",
  filter: "M4 5h16l-6 7.5V19l-4-2v-4.5z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5", strokeWidth = 1.8, filled = false }: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
