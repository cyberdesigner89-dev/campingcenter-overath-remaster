/**
 * Refresh src/data/inventory.json from the public mobile.de dealer page.
 * No dealer API and no API key: the listings sit in the Next.js RSC flight
 * (`self.__next_f`) of https://home.mobile.de/CAMPINGCENTEROVERATHGMBHCOKG.
 *
 * A failed fetch, a bot challenge, an empty parse, or an implausible drop
 * never rewrites the snapshot. `firstSeenAt` is kept for ids we already
 * know and set only for ids that are actually new. `snapshotDate` moves
 * only when the vehicle data itself changed.
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEALER_URL = 'https://home.mobile.de/CAMPINGCENTEROVERATHGMBHCOKG';
export const IMAGE_BASE = 'https://img.classistatic.de/api/v1/mo-prod/images/';
export const SOURCE_URL = DEALER_URL;

/** Financing graphics, not vehicle photos. Same set as import_inventory.py. */
const EXCLUDED_IMAGES = new Set([
  'c9/c96f811a-a034-4a11-8e0d-3a9e163dddd7',
  'd4/d4bf933a-ecb2-4066-90d8-b01754e0bf57',
]);

const CATEGORY: Record<string, readonly [string, string]> = {
  Alcoves: ['alkoven', 'Alkoven'],
  PartlyIntegrated: ['teilintegriert', 'Teilintegriert'],
  VanMotorhome: ['kastenwagen', 'Kastenwagen'],
  Integrated: ['vollintegriert', 'Vollintegriert'],
};

const VEHICLE_KEYS = [
  'id',
  'slug',
  'title',
  'make',
  'model',
  'category',
  'categoryLabel',
  'condition',
  'price',
  'vatDeductible',
  'firstRegistration',
  'mileageKm',
  'powerKw',
  'powerPs',
  'fuel',
  'transmission',
  'lengthMm',
  'grossWeightKg',
  'emissionClass',
  'previousOwners',
  'huUntil',
  'color',
  'modelYear',
  'highlights',
  'images',
  'sourceUrl',
] as const;

const TOTAL_KEYS =
  'numResults|numberOfResults|totalCount|totalResults|searchResultsCount|resultCount|adsCount|listingCount|totalItems';

export interface RawAd {
  id: string | number;
  title: string;
  make: { localized: string };
  price: { grs: { amount: number } };
  vat?: unknown;
  isConditionNew?: unknown;
  category?: unknown;
  highlights?: unknown;
  images?: unknown;
  attr?: Record<string, unknown>;
}

export interface NormalisedVehicle {
  id: string;
  slug: string;
  title: string;
  make: string;
  model: string;
  category: string;
  categoryLabel: string;
  condition: 'neu' | 'gebraucht';
  price: number;
  vatDeductible: boolean;
  firstRegistration: string | null;
  mileageKm: number | null;
  powerKw: number | null;
  powerPs: number | null;
  fuel: string | null;
  transmission: string | null;
  lengthMm: number | null;
  grossWeightKg: number | null;
  emissionClass: string | null;
  previousOwners: number | null;
  huUntil: string | null;
  color: string | null;
  modelYear: number | null;
  highlights: string[];
  images: string[];
  sourceUrl: string;
  firstSeenAt?: string;
}

export interface InventoryFile {
  source: string;
  snapshotDate: string;
  imageBase: string;
  vehicles: NormalisedVehicle[];
}

export interface PageResponse {
  status: number;
  body: string;
}

export type SyncDecision =
  | { action: 'write'; inventory: InventoryFile; reason: string }
  | { action: 'skip'; reason: string }
  | { action: 'abort'; reason: string };

export function berlinToday(now = new Date()): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`unexpected Berlin date: ${day}`);
  }
  return day;
}

export function dealerPageUrl(page: number): string {
  if (page <= 1) return DEALER_URL;
  const url = new URL(DEALER_URL);
  url.searchParams.set('page', String(page));
  return url.toString();
}

/** Below this count a sync is treated as a crash, not a real stock change. */
export function minimumKeptCount(previousCount: number): number | null {
  if (previousCount < 5) return null;
  return Math.ceil(previousCount * 0.5);
}

export function assessResponse(status: number, html: string): string | null {
  if (status !== 200) return `HTTP ${status}`;
  const challenge = /Zugriff verweigert|Access denied|cf-browser-verification|Just a moment|Attention Required/i.test(html);
  if (!html.includes('__next_f')) {
    if (challenge) return 'response looks like a bot challenge';
    if (!html || html.length < 1000) return 'response is too small to be the dealer page';
    return 'response has no Next.js RSC payload (__next_f)';
  }
  if (challenge && !html.includes('self.__next_f.push')) return 'response looks like a bot challenge';
  return null;
}

export function decodeNextFlight(html: string): string {
  const marker = 'self.__next_f.push(';
  const parts: string[] = [];
  let from = 0;
  while (from < html.length) {
    const at = html.indexOf(marker, from);
    if (at < 0) break;
    let i = at + marker.length;
    while (html[i] === ' ' || html[i] === '\n' || html[i] === '\r') i += 1;
    if (html[i] !== '[') {
      from = at + marker.length;
      continue;
    }
    i += 1;
    while (html[i] === ' ') i += 1;
    if (html[i] !== '1' || html[i + 1] !== ',') {
      from = i + 1;
      continue;
    }
    i += 2;
    while (html[i] === ' ' || html[i] === '\n' || html[i] === '\r') i += 1;
    const quoted = readQuoted(html, i);
    if (!quoted || html[i] !== '"') {
      from = i + 1;
      continue;
    }
    try {
      const value = JSON.parse(quoted.raw) as unknown;
      if (typeof value === 'string') parts.push(value);
    } catch {
      /* skip a chunk that is not a JSON string */
    }
    from = quoted.end;
  }
  return parts.join('');
}

export function extractAds(flight: string): RawAd[] {
  const found = new Map<string, RawAd>();
  for (const value of extractObjects(flight)) walk(value, (node) => rememberAd(found, node));
  return [...found.values()];
}

export function discoverTotal(flight: string, found: number): number | null {
  const re = new RegExp(`"(?:${TOTAL_KEYS})"\\s*:\\s*(\\d+)`, 'g');
  const candidates: number[] = [];
  for (const match of flight.matchAll(re)) {
    const n = Number(match[1]);
    if (Number.isInteger(n)) candidates.push(n);
  }
  const plausible = candidates.filter((n) => n >= found && n <= 400 && n <= Math.max(found + 80, found * 3));
  if (!plausible.length) return null;
  return Math.max(...plausible);
}

export function hasNextPage(flight: string, currentPage: number): boolean {
  if (/"hasNextPage"\s*:\s*true/.test(flight) || /"hasMore"\s*:\s*true/.test(flight)) return true;
  const next = currentPage + 1;
  return new RegExp(`(?:[?&]|\\\\u0026)page=${next}(?:\\D|$)`).test(flight);
}

export function normaliseAd(ad: RawAd): NormalisedVehicle | null {
  const make = ad.make.localized.trim();
  const title = cleanTitle(ad.title);
  const id = String(ad.id).trim();
  const amount = ad.price.grs.amount;
  if (!id || !make || !title || typeof amount !== 'number' || !Number.isFinite(amount)) return null;

  const attr = ad.attr ?? {};
  const model = title.toLowerCase().startsWith(make.toLowerCase()) ? title.slice(make.length).trim() : title;
  const cat = CATEGORY[typeof attr.c === 'string' ? attr.c : ''] ?? null;
  const categoryLabel = cat?.[1] ?? (typeof ad.category === 'string' && ad.category.trim() ? ad.category.trim() : 'Wohnmobil');
  const isNew = attr.con === 'Neufahrzeug' || pyBool(ad.isConditionNew);

  let transmission = typeof attr.tr === 'string' && attr.tr.trim() ? attr.tr.trim() : null;
  if (transmission === 'Schaltgetriebe' && title.toLowerCase().includes('automatik')) transmission = null;

  const pw = typeof attr.pw === 'string' ? attr.pw.replaceAll('\u00a0', ' ') : '';
  const power = pw.match(/(\d+)\s*kW\s*\((\d+)\s*PS\)/);
  const hu = typeof attr.gi === 'string' ? attr.gi.trim() : '';
  const emc = typeof attr.emc === 'string' ? attr.emc.replaceAll('Euro6', 'Euro 6').trim() : '';
  const slugBase = slugify(`${make} ${model}`);
  const slugHead = slugBase.split('-').filter((part) => part.length > 0).slice(0, 5).join('-');

  const vehicle: NormalisedVehicle = {
    id,
    slug: `${slugHead}-${id}`,
    title,
    make,
    model,
    category: cat?.[0] ?? 'sonstige',
    categoryLabel,
    condition: isNew ? 'neu' : 'gebraucht',
    price: amount,
    vatDeductible: pyBool(ad.vat),
    firstRegistration: textOrNull(attr.fr),
    mileageKm: num(attr.ml),
    powerKw: power?.[1] ? Number(power[1]) : null,
    powerPs: power?.[2] ? Number(power[2]) : null,
    fuel: textOrNull(attr.ft),
    transmission,
    lengthMm: num(attr.le),
    grossWeightKg: num(attr.lw),
    emissionClass: emc || null,
    previousOwners: integerOrNull(attr.pvo),
    huUntil: !hu ? null : hu === 'Neu' ? 'neu' : hu,
    color: textOrNull(attr.ecol),
    modelYear: integerOrNull(attr.yc),
    highlights: highlightsOf(ad.highlights),
    images: imagesOf(ad.images),
    sourceUrl: `https://suchen.mobile.de/fahrzeuge/details.html?id=${id}`,
  };
  return vehicle;
}

export function decideUpdate(previous: InventoryFile, ads: RawAd[], today: string): SyncDecision {
  if (ads.length === 0) {
    return { action: 'abort', reason: 'parsed 0 vehicles' };
  }
  const floor = minimumKeptCount(previous.vehicles.length);
  if (floor !== null && ads.length < floor) {
    return {
      action: 'abort',
      reason: `refusing to replace ${previous.vehicles.length} vehicles with ${ads.length} (below half of the current stock)`,
    };
  }

  const previousById = new Map(previous.vehicles.map((vehicle) => [String(vehicle.id), vehicle]));
  const next: NormalisedVehicle[] = [];
  for (const ad of ads) {
    const vehicle = normaliseAd(ad);
    if (!vehicle) return { action: 'abort', reason: `vehicle ${String(ad.id)} could not be normalised` };
    if (!(vehicle.price > 1000) || vehicle.images.length === 0) {
      return {
        action: 'abort',
        reason: `vehicle ${vehicle.id} is incomplete (price ${vehicle.price}, ${vehicle.images.length} photos)`,
      };
    }
    const known = previousById.get(vehicle.id);
    if (known?.firstSeenAt) vehicle.firstSeenAt = known.firstSeenAt;
    else if (!known) vehicle.firstSeenAt = today;
    next.push(vehicle);
  }
  next.sort(displaySort);

  if (canonical(previous.vehicles) === canonical(next)) {
    return { action: 'skip', reason: `inventory unchanged (${next.length} vehicles)` };
  }
  return {
    action: 'write',
    reason: `stock changed (${previous.vehicles.length} -> ${next.length} vehicles)`,
    inventory: {
      source: previous.source || SOURCE_URL,
      snapshotDate: today,
      imageBase: previous.imageBase || IMAGE_BASE,
      vehicles: next,
    },
  };
}

export async function runSync(options: {
  previous: InventoryFile;
  today: string;
  fetchPage: (url: string) => Promise<PageResponse>;
}): Promise<SyncDecision> {
  const firstUrl = dealerPageUrl(1);
  let first: PageResponse;
  try {
    first = await options.fetchPage(firstUrl);
  } catch (error) {
    return { action: 'abort', reason: `fetch failed: ${errorText(error)}` };
  }
  const problem = assessResponse(first.status, first.body);
  if (problem) return { action: 'abort', reason: problem };

  let flight = decodeNextFlight(first.body);
  let ads = extractAds(flight);
  const total = discoverTotal(flight, ads.length);
  let page = 1;
  let more = hasNextPage(flight, page) || (total !== null && total > ads.length);

  while (more && page < 15) {
    page += 1;
    let response: PageResponse;
    try {
      response = await options.fetchPage(dealerPageUrl(page));
    } catch (error) {
      if (total !== null && ads.length + 2 < total) {
        return { action: 'abort', reason: `page ${page} failed (${errorText(error)}) and the listing looks incomplete` };
      }
      break;
    }
    const pageProblem = assessResponse(response.status, response.body);
    if (pageProblem) {
      if (total !== null && ads.length + 2 < total) {
        return { action: 'abort', reason: `page ${page}: ${pageProblem}; refusing a partial stock` };
      }
      break;
    }
    flight = decodeNextFlight(response.body);
    const before = new Set(ads.map((ad) => String(ad.id)));
    ads = mergeAds(ads, extractAds(flight));
    const added = ads.some((ad) => !before.has(String(ad.id)));
    if (!added) break;
    const pageTotal = discoverTotal(flight, ads.length);
    more = hasNextPage(flight, page) || ((pageTotal ?? total) !== null && ads.length < (pageTotal ?? total ?? 0));
  }

  if (total !== null && total - ads.length >= 3 && ads.length < total * 0.8) {
    return {
      action: 'abort',
      reason: `incomplete inventory: parsed ${ads.length} of about ${total}`,
    };
  }
  return decideUpdate(options.previous, ads, options.today);
}

export function readInventory(path: string): InventoryFile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!isInventoryFile(parsed)) throw new Error(`${path} is not a vehicle snapshot`);
  return parsed;
}

export async function syncInventoryFile(options: {
  inventoryPath: string;
  today: string;
  fetchPage: (url: string) => Promise<PageResponse>;
}): Promise<SyncDecision> {
  const previous = readInventory(options.inventoryPath);
  const before = readFileSync(options.inventoryPath);
  const decision = await runSync({ previous, today: options.today, fetchPage: options.fetchPage });
  if (decision.action === 'write') atomicWrite(options.inventoryPath, decision.inventory);
  else if (!readFileSync(options.inventoryPath).equals(before)) {
    throw new Error('inventory file changed even though the sync did not decide to write');
  }
  return decision;
}

function atomicWrite(path: string, inventory: InventoryFile): void {
  const tmp = join(dirname(path), '.tmp-inventory.json');
  writeFileSync(tmp, `${JSON.stringify(inventory, null, 2)}\n`);
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the original snapshot is still in place */
    }
    throw error;
  }
}

function isInventoryFile(value: unknown): value is InventoryFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.source === 'string' && typeof record.snapshotDate === 'string' && Array.isArray(record.vehicles);
}

function rememberAd(found: Map<string, RawAd>, node: Record<string, unknown>): void {
  if (!isAd(node)) return;
  const id = String(node.id);
  const current = found.get(id);
  if (!current || richness(node) > richness(current)) found.set(id, node);
}

function isAd(value: Record<string, unknown>): value is RawAd & Record<string, unknown> {
  if ((typeof value.id !== 'number' && typeof value.id !== 'string') || typeof value.title !== 'string' || !value.title.trim()) {
    return false;
  }
  const make = value.make;
  if (!make || typeof make !== 'object' || Array.isArray(make)) return false;
  const localized = (make as Record<string, unknown>).localized;
  if (typeof localized !== 'string' || !localized.trim()) return false;
  const price = value.price;
  if (!price || typeof price !== 'object' || Array.isArray(price)) return false;
  const grs = (price as Record<string, unknown>).grs;
  if (!grs || typeof grs !== 'object' || Array.isArray(grs)) return false;
  const amount = (grs as Record<string, unknown>).amount;
  return typeof amount === 'number' && Number.isFinite(amount);
}

function richness(ad: RawAd): number {
  const images = Array.isArray(ad.images) ? ad.images.length : 0;
  const highlights = Array.isArray(ad.highlights) ? ad.highlights.length : 0;
  return images * 10 + highlights;
}

function mergeAds(current: RawAd[], extra: RawAd[]): RawAd[] {
  const map = new Map<string, RawAd>();
  for (const ad of current) map.set(String(ad.id), ad);
  for (const ad of extra) {
    const id = String(ad.id);
    const prev = map.get(id);
    if (!prev || richness(ad) > richness(prev)) map.set(id, ad);
  }
  return [...map.values()];
}

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (typeof node === 'string') {
    const text = node.trim();
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        walk(JSON.parse(text) as unknown, visit);
      } catch {
        /* string is not nested JSON */
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    visit(record);
    for (const value of Object.values(record)) walk(value, visit);
  }
}

function extractObjects(text: string): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    const next = text[i + 1];
    if (next !== '"' && next !== ' ' && next !== '\n') continue;
    const slice = sliceObject(text, i);
    if (!slice) continue;
    try {
      out.push(JSON.parse(slice) as unknown);
      i += slice.length - 1;
    } catch {
      /* not a JSON object */
    }
  }
  return out;
}

function sliceObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function readQuoted(html: string, start: number): { raw: string; end: number } | null {
  const quote = html[start];
  if (quote !== '"' && quote !== "'") return null;
  let escaped = false;
  for (let i = start + 1; i < html.length; i += 1) {
    const char = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) return { raw: html.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

function canonical(vehicles: readonly NormalisedVehicle[]): string {
  return vehicles
    .map((vehicle) => project(vehicle))
    .sort()
    .join('\n');
}

function project(vehicle: NormalisedVehicle): string {
  const ordered: Record<string, unknown> = {};
  for (const key of VEHICLE_KEYS) ordered[key] = vehicle[key];
  if (vehicle.firstSeenAt) ordered.firstSeenAt = vehicle.firstSeenAt;
  return JSON.stringify(ordered);
}

function displaySort(a: NormalisedVehicle, b: NormalisedVehicle): number {
  const condition = Number(a.condition !== 'gebraucht') - Number(b.condition !== 'gebraucht');
  if (condition !== 0) return condition;
  if (a.price !== b.price) return a.price - b.price;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function num(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const head = value.split('(')[0] ?? '';
  const digits = head.replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function highlightsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item.length > 0);
}

function imagesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const image of value) {
    const uri = image && typeof image === 'object' && !Array.isArray(image) ? (image as Record<string, unknown>).uri : null;
    const id = imageId(uri);
    if (id) ids.push(id);
  }
  return ids;
}

function imageId(uri: unknown): string | null {
  if (typeof uri !== 'string') return null;
  const marker = '/images/';
  const at = uri.indexOf(marker);
  if (at < 0) return null;
  const id = (uri.slice(at + marker.length).split('?')[0] ?? '').trim();
  if (!id || EXCLUDED_IMAGES.has(id)) return null;
  return id;
}

function slugify(value: string): string {
  const replaced = value.replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss');
  const ascii = [...replaced.normalize('NFKD')].filter((char) => (char.codePointAt(0) ?? 0) <= 127).join('');
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cleanTitle(value: string): string {
  return value.replaceAll('!', '').replaceAll('Austattung', 'Ausstattung').replace(/\s+/g, ' ').trim();
}

function pyBool(value: unknown): boolean {
  return !(value === null || value === undefined || value === false || value === 0 || value === '');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
