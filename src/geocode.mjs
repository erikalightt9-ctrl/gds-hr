// Off-site work addresses: GPS coordinates -> the most precise readable street address (OpenStreetMap Nominatim,
// or HR_GEOCODING_URL). Only what the map service returns is shown; nothing is filled in or guessed. Results are cached
// per ~1 m grid point and requests are spaced at least 1.1 s apart (Nominatim usage policy).
import { z } from 'zod';

export const DEFAULT_PROVIDER = 'https://nominatim.openstreetmap.org/reverse';
export const DEFAULT_ACCURACY_LIMIT = 50;   // metres; readings above it are recorded but flagged for HR review
const USER_AGENT = 'GDS-HR-Attendance/1.0 (hr.blkstone.site)';
const SPACING_MS = 1100;

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS geo_cache(key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL)');
export const cacheKey = (latitude, longitude) => `${Number(latitude).toFixed(5)},${Number(longitude).toFixed(5)}`;

// Address parts in the order they are written in the Philippines. Barangay is reported as quarter / suburb / village.
const PART_KEYS = {
  establishment: ['amenity', 'building', 'office', 'shop', 'tourism', 'leisure', 'healthcare', 'man_made', 'aeroway', 'railway', 'historic', 'club', 'craft'],
  houseNumber: ['house_number'],
  street: ['road', 'pedestrian', 'footway', 'residential', 'path'],
  barangay: ['quarter', 'suburb', 'village', 'neighbourhood', 'hamlet', 'city_district'],
  city: ['city', 'town', 'municipality'],
  province: ['province', 'county', 'state_district', 'state', 'region'],
  postcode: ['postcode'],
  country: ['country'],
};
const first = (address, keys) => keys.map(k => address?.[k]).find(v => typeof v === 'string' && v.trim())?.trim() || '';

export function addressParts(data) {
  const a = data?.address || {}, parts = Object.fromEntries(Object.entries(PART_KEYS).map(([part, keys]) => [part, first(a, keys)]));
  // The place's own name (e.g. "ABC Building") when the service reports one and it is not just the street.
  if (!parts.establishment && typeof data?.name === 'string' && data.name.trim() && data.name.trim() !== parts.street) parts.establishment = data.name.trim();
  if (parts.barangay && parts.barangay === parts.city) parts.barangay = '';
  return parts;
}
export function formatAddress(parts) {
  const street = [parts.houseNumber, parts.street].filter(Boolean).join(' ');
  // Written exactly as the map service names it (no "Barangay" prefix is added: the area may not be a barangay).
  const seen = new Set();
  return [parts.establishment, street, parts.barangay, parts.city, parts.province, parts.postcode, parts.country].filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase())).join(', ');
}
// What the service could not provide, so the employee is asked to check it (never filled in by the system).
export function missingParts(parts) {
  return [['street', 'street'], ['barangay', 'barangay'], ['city', 'city or municipality']].filter(([k]) => !parts[k]).map(([, label]) => label);
}

let nextSlot = 0;
async function throttle() {
  const now = Date.now(), wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + SPACING_MS;
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
}
const responseSchema = z.object({ display_name: z.string().max(2000).optional(), name: z.string().max(500).optional().nullable(), address: z.record(z.string(), z.string().max(500)).optional(), error: z.string().optional() }).passthrough();

// { formatted, parts, missing, source } or { formatted: '', error } when the address cannot be found. Never throws.
export async function reverseGeocode(store, latitude, longitude, { provider = process.env.HR_GEOCODING_URL || DEFAULT_PROVIDER, fetchImpl = fetch } = {}) {
  ensure(store);
  const key = cacheKey(latitude, longitude), cached = store.db.prepare('SELECT data FROM geo_cache WHERE key=?').get(key);
  if (cached) return JSON.parse(cached.data);
  let url;
  try { url = new URL(provider); } catch { return { formatted: '', error: 'The address service is not set up correctly.' }; }
  if (url.protocol !== 'https:') return { formatted: '', error: 'The address service must use HTTPS.' };
  Object.entries({ lat: String(latitude), lon: String(longitude), format: 'jsonv2', addressdetails: '1', zoom: '18', 'accept-language': 'en' }).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    await throttle();
    const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = responseSchema.parse(await response.json());
    if (data.error || !data.address) return { formatted: '', error: 'No address was found for this location.' };
    const parts = addressParts(data), result = { formatted: formatAddress(parts), parts, missing: missingParts(parts), source: url.hostname === 'nominatim.openstreetmap.org' ? 'OpenStreetMap' : url.hostname };
    if (!result.formatted) return { formatted: '', error: 'No address was found for this location.' };
    store.db.prepare('INSERT OR REPLACE INTO geo_cache(key,data,fetched_at) VALUES(?,?,?)').run(key, JSON.stringify(result), new Date().toISOString());
    return result;
  } catch {
    return { formatted: '', error: 'The address service could not be reached. Try again in a moment.' };
  }
}
// A cached lookup only (no network): used when the time in / out is saved, so the stored detected address is the one
// the server found, not text sent by the device.
export function cachedAddress(store, latitude, longitude) {
  ensure(store);
  const row = store.db.prepare('SELECT data FROM geo_cache WHERE key=?').get(cacheKey(latitude, longitude));
  return row ? JSON.parse(row.data) : null;
}
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}
