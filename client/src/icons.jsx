const ICONS = {
  overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  transactions: 'M4 6h16M4 12h16M4 18h10',
  budgets: 'M12 3a9 9 0 1 0 9 9h-9V3Z M14 3.5A8.5 8.5 0 0 1 20.5 10H14V3.5Z',
  accounts: 'M3 8.5 12 4l9 4.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5Z M3 9h18 M16 13h2',
  investments: 'M3 17l6-6 4 4 7-8 M15 7h5v5',
  recurring: 'M17 2l4 4-4 4 M7 22l-4-4 4-4 M21 6H9a4 4 0 0 0-4 4v1 M3 18h12a4 4 0 0 0 4-4v-1',
  import: 'M12 16V4 M7 9l5-5 5 5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  assistant: 'M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  settings: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4v6 M8 14v6',
  plus: 'M12 5v14 M5 12h14',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M15.5 15.5 20 20',
  x: 'M6 6l12 12 M18 6 6 18',
  check: 'M4 12l5 5L20 6',
  logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3 M10 8l-4 4 4 4 M6 12h9',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.3 M20 5v6h-6',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
  copy: 'M9 9h10v10H9V9Z M5 15V5h10',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  alert: 'M12 4l9 16H3L12 4Z M12 10v4 M12 17.5v.1',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  upload: 'M12 20V8 M7 13l5-5 5 5 M4 4h16',
  edit: 'M4 20h4l10-10-4-4L4 16v4Z M14 6l4 4',
  send: 'M4 12l16-8-5 16-4-7-7-1Z',
  bank: 'M3 9l9-5 9 5 M4 9h16 M6 9v8 M10 9v8 M14 9v8 M18 9v8 M3 20h18',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z M9 12l2 2 4-4',
  spark: 'M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
  arrowRight: 'M4 12h16 M14 6l6 6-6 6',
  arrowLeft: 'M20 12H4 M10 6l-6 6 6 6',
  dots: 'M6 12h.01 M12 12h.01 M18 12h.01',
  key: 'M14 10a4 4 0 1 0-3.5 3.97L9 16H7v2H5v2H3v-3l6.03-6.03A4 4 0 0 1 14 10Z',
  wallet: 'M4 7a2 2 0 0 1 2-2h11v4 M4 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1 M20 10h-5a2 2 0 0 0 0 4h5v-4Z',
};

export default function Icon({ name, size = 18, strokeWidth = 1.8, className = '', style }) {
  const path = ICONS[name] || ICONS.dots;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={path} />
    </svg>
  );
}

export function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="coveLogo" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1d3d2e" />
          <stop offset="1" stopColor="#0c1712" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill="url(#coveLogo)" stroke="rgba(61,220,151,.28)" />
      <path
        d="M13 39c6.2 0 6.2-10.5 12.4-10.5S31.8 43 38 43s6.2-9.2 12.4-9.2"
        fill="none"
        stroke="#3ddc97"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle cx="47" cy="20" r="3.6" fill="#3ddc97" />
    </svg>
  );
}
