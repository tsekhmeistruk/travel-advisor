// After a deploy: open the live site in every mode and report console errors, the header and
// the overview. Exit code 1 on any console error.
//
//   npm run live-check                       every mode
//   npm run live-check -- '#mode=highest&place=de'   also these hashes (prints the map's zoom)
//   options: --base <url> (default: the live site)

import { parseArgs } from 'node:util';
import { launch, openPage } from './browser.mjs';

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { base: { type: 'string', default: 'https://tsekhmeistruk.github.io/travel-advisor/' } } });
const base = o.base.replace(/\/?$/, '/');
// Every mode, and a war's card (Russia vs Ukraine: its sides and the dots).
const hashes = [...['wars', 'disaster', 'travel', 'highest'].map(m => `#mode=${m}`), '#mode=wars&war=1-13243', ...positionals];

const browser = await launch();
let errors = 0;
try {
  for (const hash of hashes) {
    const page = await openPage(browser, `${base}?live=${Date.now()}${hash}`, { settle: 1500 });
    const info = await page.evaluate(() => ({
      header: document.getElementById('asOf')?.textContent,
      card: document.querySelector('#details h3, #details .wars-count')?.textContent.trim(),
      feed: document.getElementById('recentCount')?.textContent,
      sides: document.querySelectorAll('#details .war-side').length,
      dots: document.querySelectorAll('.points .point').length,
      zoom: document.querySelector('.viewport')?.getAttribute('transform')?.match(/scale\(([\d.]+)/)?.[1],
    }));
    errors += page.errors.length;
    console.log(`${hash.padEnd(28)} ${page.errors.length ? `ERRORS ${page.errors.join(' | ')}` : 'ok'} | ${info.header} | ${info.card} | feed ${info.feed}${info.dots ? ` | ${info.dots} dots` : ''}${info.sides ? ` | ${info.sides} sides` : ''} | zoom ${info.zoom}`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exitCode = errors ? 1 : 0;
