// Eigenes Icon-Set "Werk": 20er-Raster, 1.5er-Strich, gerade Enden wo möglich.
// Formen sind an Factorio-Vokabular angelehnt (Module, Förderband, Kisten, Lampen).
const P = {
  logo: '<rect x="2.75" y="2.75" width="14.5" height="14.5" rx="3"/><path d="M6 13.5l3-3.5-3-3.5M10.5 13.5l3-3.5-3-3.5"/>',
  play: '<path d="M6.5 4.5v11l9-5.5z"/>',
  stop: '<rect x="5" y="5" width="10" height="10" rx="1.5"/>',
  restart: '<path d="M15.5 10a5.5 5.5 0 1 1-1.8-4.07"/><path d="M14.5 3.5v3h-3"/>',
  kill: '<path d="M10 3v6.5"/><path d="M6.2 5.7a6 6 0 1 0 7.6 0"/>',
  console: '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2"/><path d="M6 8l2.5 2L6 12M10.5 12.5H14"/>',
  files: '<path d="M2.75 6.25v8.5a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5v-6.5a1.5 1.5 0 0 0-1.5-1.5H10l-1.75-2H4.25a1.5 1.5 0 0 0-1.5 1.5z"/>',
  folder: '<path d="M2.75 6.25v8.5a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5v-6.5a1.5 1.5 0 0 0-1.5-1.5H10l-1.75-2H4.25a1.5 1.5 0 0 0-1.5 1.5z"/>',
  file: '<path d="M5.25 2.75h6l3.5 3.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5v-11.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M11.25 2.75v3.5h3.5"/>',
  filetext: '<path d="M5.25 2.75h6l3.5 3.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5v-11.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M7 10h6M7 13h4"/>',
  archive: '<rect x="3.75" y="2.75" width="12.5" height="14.5" rx="1.5"/><path d="M10 2.75v2M10 6.25v1.5M10 9.25v1.5"/><rect x="8.5" y="12" width="3" height="3" rx=".5"/>',
  // Modul (Factorio-Modul: Chip mit Kontakten)
  mods: '<rect x="5" y="5" width="10" height="10" rx="1.5"/><path d="M8 2.5V5M12 2.5V5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5"/><path d="M8.25 10h3.5"/>',
  // Spielstand: Kiste
  saves: '<path d="M3 6.5l7-3.75 7 3.75v7L10 17.25 3 13.5z"/><path d="M3 6.5l7 3.75 7-3.75M10 10.25v7"/>',
  players: '<circle cx="7.5" cy="7" r="2.75"/><path d="M2.75 16c.4-2.6 2.3-4.25 4.75-4.25s4.35 1.65 4.75 4.25"/><path d="M12.5 4.6a2.75 2.75 0 0 1 0 4.8M14.6 11.9c1.4.6 2.4 2 2.65 4.1"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M4.25 16.5c.5-3 2.75-4.75 5.75-4.75s5.25 1.75 5.75 4.75"/>',
  share: '<circle cx="8" cy="7" r="2.75"/><path d="M3 16c.4-2.6 2.4-4.25 5-4.25 1.2 0 2.3.35 3.15 1"/><path d="M15 10.5v6M12 13.5h6"/>',
  settings: '<path d="M3 5.5h8M14 5.5h3M3 14.5h3M9 14.5h8M3 10h4.5M10.5 10H17"/><circle cx="12.5" cy="5.5" r="1.5"/><circle cx="7.5" cy="14.5" r="1.5"/><circle cx="9" cy="10" r="1.5"/>',
  versions: '<path d="M10 2.75l7.25 3.75L10 10.25 2.75 6.5z"/><path d="M2.75 10L10 13.75 17.25 10M2.75 13.5L10 17.25l7.25-3.75"/>',
  server: '<rect x="2.75" y="3.25" width="14.5" height="5.5" rx="1.25"/><rect x="2.75" y="11.25" width="14.5" height="5.5" rx="1.25"/><path d="M5.5 6h1.5M5.5 14h1.5M11 6h3.5M11 14h3.5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
  check: '<path d="M4 10.5l3.75 3.75L16 6"/>',
  copy: '<rect x="6.75" y="6.75" width="10" height="10" rx="1.5"/><path d="M13.25 6.75v-2.5a1.5 1.5 0 0 0-1.5-1.5h-7.5a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h2.5"/>',
  trash: '<path d="M3.5 5.5h13M8 5.5V3.75h4V5.5M5 5.5l.75 10.75a1 1 0 0 0 1 .95h6.5a1 1 0 0 0 1-.95L15 5.5"/><path d="M8.5 9v5M11.5 9v5"/>',
  edit: '<path d="M12.5 3.75l3.75 3.75L7.5 16.25H3.75V12.5z"/><path d="M10.5 5.75l3.75 3.75"/>',
  upload: '<path d="M10 13V3.5M6 7.25L10 3.5l4 3.75"/><path d="M3.5 12.5v2.75a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V12.5"/>',
  download: '<path d="M10 3.5V13M6 9.25L10 13l4-3.75"/><path d="M3.5 12.5v2.75a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V12.5"/>',
  search: '<circle cx="8.75" cy="8.75" r="5"/><path d="M12.5 12.5l4 4"/>',
  chevron: '<path d="M8 5l5 5-5 5"/>',
  chevdown: '<path d="M5 8l5 5 5-5"/>',
  back: '<path d="M12 5l-5 5 5 5"/>',
  more: '<circle cx="5" cy="10" r=".9" fill="currentColor"/><circle cx="10" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/>',
  globe: '<circle cx="10" cy="10" r="7.25"/><path d="M2.75 10h14.5M10 2.75c2 2 3 4.4 3 7.25s-1 5.25-3 7.25c-2-2-3-4.4-3-7.25s1-5.25 3-7.25z"/>',
  key: '<circle cx="6.5" cy="13.5" r="3.25"/><path d="M8.8 11.2L16 4M13.5 6.5l2 2M11.75 8.25l1.5 1.5"/>',
  logout: '<path d="M8 3.25H5a1.5 1.5 0 0 0-1.5 1.5v10.5a1.5 1.5 0 0 0 1.5 1.5h3"/><path d="M13 6.5l3.5 3.5-3.5 3.5M16.5 10H8"/>',
  refresh: '<path d="M16 9.25A6.25 6.25 0 0 0 4.6 6.4M4 10.75a6.25 6.25 0 0 0 11.4 2.85"/><path d="M4.25 3.25v3.5h3.5M15.75 16.75v-3.5h-3.5"/>',
  cpu: '<rect x="5" y="5" width="10" height="10" rx="1.5"/><rect x="8" y="8" width="4" height="4" rx=".5"/><path d="M8 2.5V5M12 2.5V5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5"/>',
  memory: '<rect x="2.75" y="5.75" width="14.5" height="7.5" rx="1"/><path d="M5.5 13.25v2.5M8.5 13.25v2.5M11.5 13.25v2.5M14.5 13.25v2.5M6 8.5v2M10 8.5v2M14 8.5v2"/>',
  disk: '<rect x="2.75" y="4.25" width="14.5" height="11.5" rx="2"/><path d="M2.75 11.25h14.5"/><circle cx="14" cy="13.5" r=".75" fill="currentColor"/>',
  lock: '<rect x="4" y="8.75" width="12" height="8" rx="1.5"/><path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25"/>',
  link: '<path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1"/>',
  rocket: '<path d="M10 2.75c2.5 1.75 3.75 4.25 3.75 7.5v3.5h-7.5v-3.5c0-3.25 1.25-5.75 3.75-7.5z"/><path d="M6.25 11.5l-2.25 2v2.5h2.25M13.75 11.5l2.25 2v2.5h-2.25M8.75 16.25v1.25M11.25 16.25v1.25"/><circle cx="10" cy="8" r="1.25"/>',
  wagon: '<rect x="2.75" y="4.75" width="14.5" height="8.5" rx="1"/><path d="M6.5 4.75v8.5M10 4.75v8.5M13.5 4.75v8.5"/><circle cx="5.75" cy="15.25" r="1.25"/><circle cx="14.25" cy="15.25" r="1.25"/><path d="M1.75 13.25h16.5"/>',
  fluidwagon: '<rect x="2.75" y="5.25" width="14.5" height="7.5" rx="3.75"/><path d="M10 7.5c-1 1.25-1.5 2-1.5 2.6a1.5 1.5 0 0 0 3 0c0-.6-.5-1.35-1.5-2.6z"/><circle cx="5.75" cy="15.25" r="1.25"/><circle cx="14.25" cy="15.25" r="1.25"/><path d="M1.75 13.25h16.5"/>',
  bolt: '<path d="M11.25 2.75 4.75 11h4.5l-.5 6.25L15.25 9h-4.5z"/>',
  smoke: '<path d="M5.5 16.25h9.5a2.75 2.75 0 0 0 .4-5.47A4.25 4.25 0 0 0 7.2 9.4a3.25 3.25 0 0 0-1.7 6.85z"/><path d="M6.25 6.75c0-1.5 1.5-1.5 1.5-3M10 6.25c0-1.25 1.25-1.25 1.25-2.5"/>',
  image: '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1.5"/><circle cx="7.25" cy="8" r="1.5"/><path d="M2.75 14l4-4 3 3 2.5-2.5 5 5"/>',
  tree: '<rect x="2.75" y="2.75" width="5" height="4" rx="1"/><rect x="12.25" y="8" width="5" height="4" rx="1"/><rect x="12.25" y="13.25" width="5" height="4" rx="1"/><path d="M5.25 6.75v8.5h7M5.25 10h7"/>',
  belt: '<rect x="2.75" y="5.75" width="14.5" height="8.5" rx="1.5"/><path d="M6 8.25l1.75 1.75L6 11.75M10 8.25l1.75 1.75L10 11.75M14 8.25"/>',
  // Ratio: zwei Maschinen, Fließband dazwischen, Teilungsmarken
  ratio: '<rect x="2.75" y="4.75" width="5.5" height="10.5" rx="1.25"/><rect x="11.75" y="4.75" width="5.5" height="10.5" rx="1.25"/><path d="M8.25 10h3.5M10.25 8.5l1.5 1.5-1.5 1.5"/><path d="M4.5 8h2M4.5 12h2M13.5 10h2"/>',
  info: '<circle cx="10" cy="10" r="7.25"/><path d="M10 9v5M10 6.25v.5"/>',
  warn: '<path d="M10 3l7.5 13.25h-15z"/><path d="M10 8.5v3.75M10 14v.25"/>',
  sun: '<circle cx="10" cy="10" r="3.25"/><path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.25 1.25M14.05 14.05l1.25 1.25M4.7 15.3l1.25-1.25M14.05 5.95l1.25-1.25"/>',
  moon: '<path d="M15.75 12.5A6.75 6.75 0 0 1 7.5 4.25a6.75 6.75 0 1 0 8.25 8.25z"/>',
  menu: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
  pin: '<path d="M10 17.25s5.25-4.5 5.25-9a5.25 5.25 0 0 0-10.5 0c0 4.5 5.25 9 5.25 9z"/><circle cx="10" cy="8.25" r="1.75"/>',
  star: '<path d="M10 3l2.1 4.5 4.9.6-3.6 3.3 1 4.85L10 13.8l-4.4 2.45 1-4.85L3 8.1l4.9-.6z"/>',
  newfile: '<path d="M11.25 2.75h-6a1.5 1.5 0 0 0-1.5 1.5v11.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-9.5z"/><path d="M11.25 2.75v3.5h3.5M10 9v5M7.5 11.5h5"/>',
  newfolder: '<path d="M2.75 6.25v8.5a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5v-6.5a1.5 1.5 0 0 0-1.5-1.5H10l-1.75-2H4.25a1.5 1.5 0 0 0-1.5 1.5z"/><path d="M10 9.5v4.5M7.75 11.75h4.5"/>',
};

export function icon(name, size = 16, cls = '') {
  const span = document.createElement('span');
  span.className = 'ic ' + cls;
  span.setAttribute('aria-hidden', 'true');
  const filled = name === 'play';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.file}</svg>`;
  return span;
}

export function iconSvg(name) {
  return `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}
