import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assessResponse,
  berlinToday,
  decodeNextFlight,
  decideUpdate,
  discoverTotal,
  extractAds,
  normaliseAd,
  syncInventoryFile,
  type InventoryFile,
  type NormalisedVehicle,
  type RawAd,
} from '../scripts/inventory-sync.ts';

const CHALLENGE = '<!DOCTYPE html><html><title>Zugriff verweigert / Access denied</title><p>Akamai</p></html>';

function ad(overrides: Partial<RawAd> = {}): RawAd {
  return {
    id: 457131578,
    title: 'Challenger C256 Start Edition Solar Markise Fahrradträger',
    make: { localized: 'Challenger' },
    price: { grs: { amount: 46000 } },
    vat: false,
    isConditionNew: false,
    highlights: ['7 Sitzer', '4 Tonnen'],
    images: [{ uri: 'https://img.classistatic.de/api/v1/mo-prod/images/45/4526111a-7c30-49f6-b1c1-d7c9b3d3ea1b' }],
    attr: {
      c: 'Alcoves',
      con: 'Gebrauchtfahrzeug',
      tr: 'Schaltgetriebe',
      pw: '118 kW (160 PS)',
      fr: '06/2021',
      ml: '69.000 km',
      ft: 'Diesel',
      le: '6.967 mm',
      lw: '3.500 kg',
      emc: 'Euro6d-TEMP',
      pvo: '2',
      gi: '05/2027',
      ecol: 'Weiß',
    },
    ...overrides,
  };
}

function vehicle(partial: Partial<NormalisedVehicle> & Pick<NormalisedVehicle, 'id' | 'price'>): NormalisedVehicle {
  const base = normaliseAd(ad({ id: partial.id, price: { grs: { amount: partial.price } } }));
  if (!base) throw new Error('fixture ad did not normalise');
  return { ...base, ...partial, id: String(partial.id) };
}

function snapshot(vehicles: NormalisedVehicle[], snapshotDate = '2026-09-30'): InventoryFile {
  return {
    source: 'https://home.mobile.de/CAMPINGCENTEROVERATHGMBHCOKG',
    snapshotDate,
    imageBase: 'https://img.classistatic.de/api/v1/mo-prod/images/',
    vehicles,
  };
}

function page(data: unknown): string {
  const flight = `0:${JSON.stringify(data)}`;
  return `<!DOCTYPE html><html><head></head><body><script>self.__next_f.push([1,${JSON.stringify(flight)}])</script></body></html>`;
}

describe('mobile.de RSC parser', () => {
  it('decodes flight chunks and finds listings, including string-encoded ones', () => {
    const html = page({
      numResults: 2,
      listings: [ad()],
      blob: JSON.stringify(ad({ id: 99, title: 'La Strada Avanti', make: { localized: 'La Strada' }, price: { grs: { amount: 80000 } } })),
    });
    const flight = decodeNextFlight(html);
    expect(flight.startsWith('0:{')).toBe(true);
    const ads = extractAds(flight);
    expect(ads.map((item) => String(item.id)).sort()).toEqual(['457131578', '99']);
    expect(discoverTotal(flight, ads.length)).toBe(2);
  });

  it('normalises a listing the same way as the offline importer', () => {
    const parsed = normaliseAd(
      ad({
        title: 'Challenger C256 Automatik Austattung!',
        images: [
          { uri: 'https://img.classistatic.de/api/v1/mo-prod/images/45/4526111a-7c30-49f6-b1c1-d7c9b3d3ea1b' },
          { uri: 'https://img.classistatic.de/api/v1/mo-prod/images/c9/c96f811a-a034-4a11-8e0d-3a9e163dddd7' },
        ],
        attr: {
          c: 'Alcoves',
          tr: 'Schaltgetriebe',
          pw: '118\u00a0kW (160 PS)',
          ml: '69.000 km',
          le: '6.967 mm',
          emc: 'Euro6d-TEMP',
          gi: 'Neu',
          pvo: '2',
        },
      }),
    );
    expect(parsed?.title).toBe('Challenger C256 Automatik Ausstattung');
    expect(parsed?.slug).toBe('challenger-c256-automatik-ausstattung-457131578');
    expect(parsed?.transmission).toBeNull();
    expect(parsed?.powerKw).toBe(118);
    expect(parsed?.mileageKm).toBe(69000);
    expect(parsed?.lengthMm).toBe(6967);
    expect(parsed?.emissionClass).toBe('Euro 6d-TEMP');
    expect(parsed?.huUntil).toBe('neu');
    expect(parsed?.images).toEqual(['45/4526111a-7c30-49f6-b1c1-d7c9b3d3ea1b']);
    expect(parsed?.category).toBe('alkoven');
  });
});

describe('inventory sync safety', () => {
  it('rejects challenges, empty payloads and implausible drops before any write', async () => {
    const previous = snapshot(Array.from({ length: 10 }, (_, index) => vehicle({ id: String(100 + index), price: 20000 + index })));
    const file = writeTemp(previous);

    const challenge = await syncInventoryFile({
      inventoryPath: file,
      today: '2026-11-23',
      fetchPage: async () => ({ status: 403, body: CHALLENGE }),
    });
    expect(challenge).toEqual({ action: 'abort', reason: 'HTTP 403' });
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(previous));

    const empty = await syncInventoryFile({
      inventoryPath: file,
      today: '2026-11-23',
      fetchPage: async () => ({ status: 200, body: page({ listings: [] }) }),
    });
    expect(empty.action).toBe('abort');
    expect(empty.reason).toContain('0 vehicles');
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(previous));

    const crashed = await syncInventoryFile({
      inventoryPath: file,
      today: '2026-11-23',
      fetchPage: async () => ({ status: 200, body: page({ listings: [ad()] }) }),
    });
    expect(crashed.action).toBe('abort');
    expect(crashed.reason).toContain('below half');
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(previous));
    expect(assessResponse(200, CHALLENGE)).toMatch(/bot challenge|RSC payload/);
  });

  it('keeps snapshotDate and firstSeenAt stable when nothing changed, and dates only real arrivals', () => {
    const current = vehicle({ id: '1', price: 30000 });
    const known = vehicle({ id: '2', price: 40000, firstSeenAt: '2026-05-01' });
    const previous = snapshot([current, known]);
    const same = decideUpdate(previous, [ad({ id: '1', price: { grs: { amount: 30000 } } }), ad({ id: '2', price: { grs: { amount: 40000 } } })], '2026-11-23');
    expect(same.action).toBe('skip');

    const changed = decideUpdate(
      previous,
      [
        ad({ id: '1', price: { grs: { amount: 31000 } } }),
        ad({ id: '2', price: { grs: { amount: 40000 } } }),
        ad({ id: '3', title: 'Eura Mobil Contura', make: { localized: 'Eura Mobil' }, price: { grs: { amount: 90000 } } }),
      ],
      '2026-11-23',
    );
    expect(changed.action).toBe('write');
    if (changed.action !== 'write') return;
    expect(changed.inventory.snapshotDate).toBe('2026-11-23');
    const byId = new Map(changed.inventory.vehicles.map((item) => [item.id, item]));
    expect(byId.get('1')?.firstSeenAt).toBeUndefined();
    expect(byId.get('1')?.price).toBe(31000);
    expect(byId.get('2')?.firstSeenAt).toBe('2026-05-01');
    expect(byId.get('3')?.firstSeenAt).toBe('2026-11-23');
  });

  it('follows a later page and refuses a short parse when the page reports a much larger total', async () => {
    const previous = snapshot([vehicle({ id: '1', price: 30000 })]);
    const calls: string[] = [];
    const decision = await syncInventoryFile({
      inventoryPath: writeTemp(previous),
      today: '2026-11-23',
      fetchPage: async (url) => {
        calls.push(url);
        if (url.includes('page=2')) {
          return { status: 200, body: page({ listings: [ad({ id: 2, price: { grs: { amount: 51000 } } })] }) };
        }
        return { status: 200, body: page({ numResults: 2, listings: [ad({ id: 1, price: { grs: { amount: 30000 } } })] }) };
      },
    });
    expect(calls.some((url) => url.includes('page=2'))).toBe(true);
    expect(decision.action).toBe('write');
    if (decision.action !== 'write') return;
    expect(decision.inventory.vehicles.map((item) => item.id).sort()).toEqual(['1', '2']);

    const incomplete = await syncInventoryFile({
      inventoryPath: writeTemp(previous),
      today: '2026-11-23',
      fetchPage: async (url) => {
        if (url.includes('page=')) return { status: 403, body: CHALLENGE };
        return { status: 200, body: page({ numResults: 12, listings: [ad({ id: 1, price: { grs: { amount: 30000 } } })] }) };
      },
    });
    expect(incomplete.action).toBe('abort');
    expect(incomplete.reason).toMatch(/partial|incomplete/i);
  });

  it('uses the Berlin calendar day and the showroom Stand line follows snapshotDate', () => {
    expect(berlinToday(new Date('2026-11-23T22:30:00Z'))).toBe('2026-11-23');
    expect(berlinToday(new Date('2026-11-23T23:30:00Z'))).toBe('2026-11-24');
    const pageSource = readFileSync('src/pages/wohnmobile/index.astro', 'utf8');
    expect(pageSource).toContain('Stand {formatDateDE(snapshotDate)}');
  });
});

function writeTemp(inventory: InventoryFile): string {
  const dir = mkdtempSync(join(tmpdir(), 'cco-inventory-'));
  const file = join(dir, 'inventory.json');
  writeFileSync(file, JSON.stringify(inventory));
  return file;
}
