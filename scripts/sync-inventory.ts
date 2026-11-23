/**
 * Pull the public dealer page and refresh src/data/inventory.json.
 * Exits 0 when the file is updated or already current.
 * Exits 1 without touching the file when the fetch or the parse is unsafe.
 */
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { DEALER_URL, berlinToday, syncInventoryFile, type PageResponse } from './inventory-sync.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = join(ROOT, 'src/data/inventory.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchPage(url: string): Promise<PageResponse> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(35_000),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1',
    },
  });
  return { status: response.status, body: await response.text() };
}

export async function main(): Promise<number> {
  console.log(`Syncing inventory from ${DEALER_URL}`);
  try {
    const decision = await syncInventoryFile({
      inventoryPath: INVENTORY_PATH,
      today: berlinToday(),
      fetchPage,
    });
    if (decision.action === 'abort') {
      console.error(`inventory sync aborted: ${decision.reason}`);
      console.error('src/data/inventory.json was not modified.');
      return 1;
    }
    console.log(decision.reason);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`inventory sync aborted: ${message}`);
    console.error('src/data/inventory.json was not modified.');
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
