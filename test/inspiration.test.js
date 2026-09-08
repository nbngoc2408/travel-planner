const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeInspirationUrl, resolveInspirationLink } = require('../src/domain/inspiration');

const ROOT = path.join(__dirname, '..');
const mappings = require(path.join(ROOT, 'data/seed/inspiration-links.json'));
const places = require(path.join(ROOT, 'data/seed/places.json'));
const destinations = require(path.join(ROOT, 'data/seed/destinations.json'));

test('supported links resolve to the existing canonical place without duplicating catalog data', () => {
  for (const [url, placeId, name] of [
    ['https://vt.tiktok.com/ZSVbhasUT/', 'place-deo-prenn', 'Đèo Prenn'],
    ['https://vt.tiktok.com/ZSVbhHhoe/', 'place-dalat-wonderland', 'Dalat Wonderland']
  ]) {
    const result = resolveInspirationLink(url, mappings, places);
    assert.equal(result.status, 'matched');
    assert.equal(result.place.id, placeId);
    assert.equal(result.place.name, name);
    assert.equal(result.mapping.catalogPlaceId, placeId);
  }
});

test('recognized out-of-catalog links retain display metadata but cannot become places', () => {
  for (const [url, name, region] of [
    ['https://vt.tiktok.com/ZSVbMC4aw/', 'Bàu Trắng', 'Bình Thuận'],
    ['https://vt.tiktok.com/ZSVbB2kVS/', 'Tháp Bà Ponagar', 'Nha Trang · Khánh Hòa'],
    ['https://vt.tiktok.com/ZSVbBGPu2/', 'Tuyệt Tình Cốc', 'Ninh Bình'],
    ['https://www.tiktok.com/@toiyeuvietnam.vibe/video/7580206964496436487?t=another-copy', 'Biển Hồ Pleiku', 'Pleiku · Gia Lai']
  ]) {
    const result = resolveInspirationLink(url, mappings, places);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.mapping.resolved.name, name);
    assert.equal(result.mapping.resolved.region, region);
    assert.equal(result.mapping.catalogPlaceId, null);
    assert.equal(result.place, undefined);
  }
});

test('resolver conservatively normalizes URLs and separates unknown from invalid input', () => {
  assert.equal(resolveInspirationLink('  HTTPS://VT.TIKTOK.COM/ZSVbhasUT/\n', mappings, places).place.name, 'Đèo Prenn');
  assert.equal(normalizeInspirationUrl('hello world').valid, false);
  assert.equal(resolveInspirationLink('https://vt.tiktok.com/not-a-known-place/', mappings, places).status, 'unsupported');
  assert.equal(resolveInspirationLink('hello world', mappings, places).status, 'invalid');
});

test('inspiration data preserves the original destination catalog and has no dangling canonical reference', () => {
  assert.deepEqual(destinations.map((item) => item.id), ['dest-vinh-hy', 'dest-da-lat', 'dest-hanoi']);
  const placeIds = new Set(places.map((item) => item.id));
  for (const mapping of mappings) {
    assert.ok(mapping.resolved?.name && mapping.resolved?.region, `${mapping.id} exposes recognized metadata`);
    if (mapping.catalogPlaceId) assert.ok(placeIds.has(mapping.catalogPlaceId), `${mapping.id} references a canonical place`);
  }
  assert.equal(places.some((item) => ['dest-binh-thuan', 'dest-nha-trang', 'dest-ninh-binh', 'dest-pleiku'].includes(item.destinationId)), false);
});
