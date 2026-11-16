/** The logo as hosted with the web app; PDF templates are static strings, so the URL cannot depend on the environment. */
export const BRAND_LOGO_URL =
  'https://www.mediarogya.in/app/assets/images/mediarogya-logo.png';

/** Logo and name as inline HTML for PDFs and printed pages; the icon is square, `heightPx` tall. */
export const brandLogoHtml = (
  heightPx = 30,
  fontPx = Math.round(heightPx * 0.55)
) =>
  `<span style="display:inline-flex;align-items:center;gap:6px;"><img src="${BRAND_LOGO_URL}" alt="" style="height:${heightPx}px;width:${heightPx}px;object-fit:contain;" /><span style="font-size:${fontPx}px;font-weight:700;color:#0a6c74;">MediArogya</span></span>`;
