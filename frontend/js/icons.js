/* ===========================================================================
   NovaPay V6.0 — 内联 SVG 图标库（无外部 CDN，离线可用）
   ic(name) 返回 <svg> 字符串；NETLOGOS 为卡组织标识。
   商标说明：Visa / Mastercard / Amex 为各自公司注册商标，此处为演示用途近似复刻。
   =========================================================================== */
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 14.5h5"/>',
  transfer: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
  gift: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18M12 8v12M12 8S9 3 7 5s2 3 5 3M12 8s3-5 5-3-2 3-5 3"/>',
  sub: '<path d="M4 12a8 8 0 0 1 14-5.3L20 8M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-14 5.3L4 16M4 20v-4h4"/>',
  chat: '<path d="M4 5h16v11H9l-4 4V5z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5.3L20 8M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-14 5.3L4 16M4 20v-4h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A9.5 9.5 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 3.9-.8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H5a2 2 0 0 0 0 4h14v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><circle cx="17" cy="13" r="1.4" fill="currentColor"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1.2" fill="currentColor"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M16 16l2-2M19 19l2-2"/>',
  shieldCheck: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v5M12 17h.01"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  paperPlane: '<path d="M21 3 3 11l7 3 3 7 8-18z"/><path d="M10 14l4-4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>',
  fingerprint: '<path d="M12 4a8 8 0 0 0-8 8M20 12a8 8 0 0 0-4-7M8 20a12 12 0 0 1-1-6 5 5 0 0 1 9-3M12 12v3a8 8 0 0 0 2 6"/>',
  scale: '<path d="M12 3v18M5 21h14M6 7l-3 7h6l-3-7M18 7l-3 7h6l-3-7M3 14h18"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
};

function ic(name, cls) {
  const p = ICONS[name] || ICONS.info;
  return `<svg class="ic ${cls||''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ===========================================================================
   卡组织标识 — 使用真实品牌色彩和字形的近似复刻
   注：Visa、Mastercard、Amex 均为注册商标，此处仅供演示用途
   =========================================================================== */
const NETLOGOS = {
  /* Visa — 官方蓝色 #1A1F71 + 白色斜体 */
  Visa: `<svg viewBox="0 0 52 16" height="18" aria-label="Visa" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.5 11.5h-2.3l1.5-7.3h2.3z" fill="#fff" opacity=".9"/>
    <path d="M24 4.2l-2.8 7.3h-2.2l1.1-2.6-1.3-4.7h2.3l.6 2.3.6-2.3H24z" fill="#fff" opacity=".9"/>
    <text x="8" y="12" font-family="Arial Black, Arial, sans-serif" font-style="italic" font-weight="900" font-size="13.5" letter-spacing="2.2" fill="#fff">VISA</text>
  </svg>`,

  /* MasterCard — 双圆重叠，红+橙 */
  MasterCard: `<svg viewBox="0 0 46 28" height="22" aria-label="Mastercard" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="14" r="12" fill="#EB001B"/>
    <circle cx="30" cy="14" r="12" fill="#F79E1B"/>
  </svg>`,

  /* American Express — 深蓝+白字 */
  Amex: `<svg viewBox="0 0 50 16" height="16" aria-label="American Express" xmlns="http://www.w3.org/2000/svg">
    <rect width="50" height="16" rx="2" fill="#006FCF"/>
    <text x="25" y="11.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="8" letter-spacing="0.5" fill="#fff">AMEX</text>
  </svg>`,

  /* Discover — 橙色圆圈 */
  Discover: `<svg viewBox="0 0 46 28" height="22" aria-label="Discover" xmlns="http://www.w3.org/2000/svg">
    <circle cx="23" cy="14" r="11" fill="#FF6000"/>
    <text x="23" y="17.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="6" letter-spacing="0.5" fill="#fff">DISCOVER</text>
  </svg>`,

  /* UnionPay — 红蓝绿三色 */
  UnionPay: `<svg viewBox="0 0 46 28" height="22" aria-label="UnionPay" xmlns="http://www.w3.org/2000/svg">
    <rect width="46" height="28" rx="4" fill="#E8443A"/>
    <rect x="0" y="14" width="46" height="14" fill="#2B6CC4"/>
    <rect x="0" y="20" width="46" height="8" fill="#78BE20"/>
    <text x="23" y="17" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="7" letter-spacing="1" fill="#fff">UNIONPAY</text>
  </svg>`,

  /* NovaPay 品牌 */
  NovaPay: `<svg viewBox="0 0 32 32" height="24" aria-label="NovaPay" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="npGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#e7c97a"/>
        <stop offset="100%" stop-color="#c9a24b"/>
      </linearGradient>
    </defs>
    <circle cx="16" cy="16" r="14" fill="none" stroke="url(#npGrad)" stroke-width="1.8"/>
    <text x="16" y="21.5" text-anchor="middle" font-family="Georgia, serif" font-weight="800" font-size="16" fill="url(#npGrad)">N</text>
  </svg>`,
};

function netLogo(name) {
  if (!name) return NETLOGOS.NovaPay;
  const n = name.toLowerCase();
  if (n === 'visa') return NETLOGOS.Visa;
  if (n === 'mastercard' || n === 'master card') return NETLOGOS.MasterCard;
  if (n === 'american express' || n === 'amex') return NETLOGOS.Amex;
  if (n === 'discover') return NETLOGOS.Discover;
  if (n === 'unionpay') return NETLOGOS.UnionPay;
  return NETLOGOS.NovaPay;
}

if (typeof window !== 'undefined') {
  window.ICONS = ICONS;
  window.ic = ic;
  window.netLogo = netLogo;
}
