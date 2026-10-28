/** Line icons drawn on a 20-unit grid, coloured by the text colour around them. */
const PATHS = {
  select: 'M5 3l10 6.5-4.4.9 2.6 5.1-1.8.9-2.6-5.1L5 14.5z',
  measure: 'M3.5 16.5l13-13M6 11l1.5 1.5M8.5 8.5L10 10M11 6l1.5 1.5M3.5 16.5l-1-1 13-13 1 1z',
  fill: 'M4 10l6-6 6 6-6 6zM16.5 13.5s1.5 1.8 1.5 2.8a1.5 1.5 0 01-3 0c0-1 1.5-2.8 1.5-2.8z',
  cutout: 'M6.5 6.5m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0M6.5 13.5m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0M8.6 7.9L17 15M8.6 12.1L17 5',
  scale: 'M2.5 7.5h15v5h-15zM5.5 7.5v2.5M8.5 7.5v1.5M11.5 7.5v2.5M14.5 7.5v1.5',
  calibrate: 'M3 10h14M3 7v6M17 7v6M10 3v3M10 14v3',
  link: 'M8.5 11.5a3.5 3.5 0 005 0l2.5-2.5a3.5 3.5 0 00-5-5L9.8 5.2M11.5 8.5a3.5 3.5 0 00-5 0L4 11a3.5 3.5 0 005 5l1.2-1.2',
  graph: 'M5 5m-2 0a2 2 0 104 0 2 2 0 10-4 0M15 6m-2 0a2 2 0 104 0 2 2 0 10-4 0M9 15m-2 0a2 2 0 104 0 2 2 0 10-4 0M6.8 5.6L13 6M5.8 6.8L8.2 13.2M14 7.8L10.2 13.4',
  back: 'M12.5 4.5L7 10l5.5 5.5',
  forward: 'M7.5 4.5L13 10l-5.5 5.5',
  tag: 'M3 3.5h6.2l7.3 7.3-5.7 5.7L3.5 9.2zM6.8 6.8m-1.1 0a1.1 1.1 0 102.2 0 1.1 1.1 0 10-2.2 0',
  sparkle: 'M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4-4.4-1.6 4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  walls: 'M3 4h14v12H3zM3 9h7M10 4v12M13 9h4',
  upload: 'M10 13V3.5M6.5 7L10 3.5 13.5 7M4 11.5V16h12v-4.5',
  download: 'M10 3.5V13M6.5 9.5L10 13l3.5-3.5M4 11.5V16h12v-4.5',
  trash: 'M4 5.5h12M8 5.5V4h4v1.5M5.5 5.5l.8 10.5h7.4l.8-10.5M8.5 8.5v5M11.5 8.5v5',
  edit: 'M12.5 4l3.5 3.5-8.5 8.5H4v-3.5zM10.5 6l3.5 3.5',
  plus: 'M10 4v12M4 10h12',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  search: 'M8.5 8.5m-5 0a5 5 0 1010 0 5 5 0 10-10 0M12.2 12.2L16.5 16.5',
  undo: 'M7.5 5L4 8.5 7.5 12M4 8.5h8a4 4 0 010 8H9',
  redo: 'M12.5 5L16 8.5 12.5 12M16 8.5H8a4 4 0 000 8h3',
  clock: 'M10 10m-7 0a7 7 0 1014 0 7 7 0 10-14 0M10 6v4l2.5 2',
  list: 'M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01',
  sigma: 'M15 4H5l5 6-5 6h10',
  zoomIn: 'M10 5v10M5 10h10',
  zoomOut: 'M5 10h10',
  fit: 'M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4',
  chevron: 'M7.5 4.5L13 10l-5.5 5.5',
  chevronDown: 'M5 7.5l5 5 5-5',
  close: 'M5 5l10 10M15 5L5 15',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  sheet: 'M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5',
  area: 'M3.5 6l6-3 7 4-1.5 9-9 1z',
  linear: 'M3 15l5-7 4 3 5-7',
  count: 'M10 10m-3.5 0a3.5 3.5 0 107 0 3.5 3.5 0 10-7 0',
  gear: 'M10 10m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  doc: 'M5 2.5h10v15H5zM7.5 6.5h5M7.5 9.5h5M7.5 12.5h3',
  door: 'M3.5 16.5h13M6 16.5V3.5h8v13M11.5 10.5h.01',
  marquee: 'M3 6V3h3M9 3h2M14 3h3v3M17 9v2M3 9v2M3 14v3h3M9 17h2M14 17h3v-3',
  eye: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10zM10 10m-2.3 0a2.3 2.3 0 104.6 0 2.3 2.3 0 10-4.6 0',
  eyeOff: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10zM10 10m-2.3 0a2.3 2.3 0 104.6 0 2.3 2.3 0 10-4.6 0M3.5 3.5l13 13',
  folder: 'M2.5 5.5V15.5h15V7.5H9.5L8 5.5z',
  folderPlus: 'M2.5 5.5V15.5h15V7.5H9.5L8 5.5zM10 9.5v4M8 11.5h4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  return (
    <svg
      className={`icon-svg${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
