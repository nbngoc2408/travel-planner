function normalizeInspirationUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { valid: false, normalizedUrl: '', key: '' };
  let url;
  try { url = new URL(raw); } catch { return { valid: false, normalizedUrl: '', key: '' }; }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return { valid: false, normalizedUrl: '', key: '' };

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const tiktokVideo = host === 'tiktok.com' && path.match(/^\/@[^/]+\/video\/(\d+)$/);
  const key = tiktokVideo ? `tiktok.com/video/${tiktokVideo[1]}` : `${host}${path}`;
  const normalizedUrl = `https://${host}${path}${tiktokVideo ? '' : url.search}${tiktokVideo ? '' : url.hash}`;
  return { valid: true, normalizedUrl, key };
}

function resolveInspirationLink(value, mappings, allPlaces) {
  const normalized = normalizeInspirationUrl(value);
  if (!normalized.valid) return { status: 'invalid' };
  const mapping = (mappings || []).find((item) => item.matchKey === normalized.key) || null;
  if (!mapping) return { status: 'unsupported', normalizedUrl: normalized.normalizedUrl };
  if (!mapping.catalogPlaceId) return { status: 'unavailable', mapping, normalizedUrl: normalized.normalizedUrl };
  const place = (allPlaces || []).find((item) => item.id === mapping.catalogPlaceId) || null;
  if (!place) return { status: 'unavailable', mapping, normalizedUrl: normalized.normalizedUrl };
  return { status: 'matched', mapping, place, normalizedUrl: normalized.normalizedUrl };
}

module.exports = { normalizeInspirationUrl, resolveInspirationLink };
