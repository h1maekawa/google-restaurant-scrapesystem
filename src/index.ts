// src/index.ts

import { loadConfig } from './config/config';
import { runScraper } from './core/scraper';

async function main(): Promise<void> {
  const config = loadConfig();
  await runScraper(config);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
