import 'dotenv/config';
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const NON_EVENT_TITLES = new Set([
  'events & entertainment', 'social calendar', 'add your own event to this calendar',
  'events', 'entertainment', 'calendar', 'weekender', 'submit an event',
]);

function isNonEvent(title) {
  if (!title || title.length < 5) return true;
  if (NON_EVENT_TITLES.has(title.toLowerCase())) return true;
  if (title === title.toUpperCase() && title.length < 40) return true;
  return false;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getWeekenderUrl(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `https://www.pasadenanow.com/weekendr/events/?s_from_mm=${p(date.getMonth() + 1)}&s_from_dd=${p(date.getDate())}&s_from_yy=${date.getFullYear()}`;
}

function eachDay(startDate, endDate) {
  const days = [];
  const d = new Date(startDate);
  d.setHours(12, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(12, 0, 0, 0);
  while (d <= end) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

async function scrapeFullDescription(page, detailUrl) {
  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800);

    const result = await page.evaluate(() => {
      const skipPatterns = [
        /cost:/i, /sponsor:/i, /for more information/i, /or click here/i,
        /bookmark/i, /share/i, /print/i,
      ];
      // Matches text that is just a venue name + address block with no narrative content
      const addressPattern = /\d+\s+\w+[\w\s]*\b(St|Ave|Blvd|Dr|Rd|Way|Ln|Ct|Pkwy)[\.,]?\s*(Pasadena|CA)/i;

      const paras = Array.from(document.querySelectorAll('p, td'))
        .map(el => (el.innerText || '').trim())
        .filter(t =>
          t.length > 30 &&
          !skipPatterns.some(p => p.test(t)) &&
          !addressPattern.test(t)
        );

      // Find the "Or click here" external event link
      const clickHereLink = Array.from(document.querySelectorAll('a')).find(a => {
        const prev = (a.previousSibling?.textContent || a.parentElement?.innerText || '').toLowerCase();
        return prev.includes('click here') || (a.innerText || '').toLowerCase().includes('click here');
      });
      const externalUrl = clickHereLink?.href || null;

      return {
        description: paras.slice(0, 4).join(' ').substring(0, 800),
        externalUrl,
      };
    });

    return result;
  } catch {
    return { description: '', externalUrl: null };
  }
}

export async function scrapeEvents(startDate = new Date(), endDate = null, onProgress = () => {}) {
  if (!endDate) endDate = startDate;
  const days = eachDay(startDate, endDate);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const listPage = await context.newPage();

  try {
    // Pass 1: collect raw listings from each day's page
    const seen = new Set();
    const filtered = [];

    for (let di = 0; di < days.length; di++) {
      const day = days[di];
      const url = getWeekenderUrl(day);
      console.log(`Scraping listing: ${url}`);
      onProgress('scraping', di, days.length, `Loading ${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}...`);

      await listPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await listPage.waitForTimeout(2000);

      const dayEvents = await listPage.evaluate(() => {
        const results = [];
        const infoLinks = Array.from(document.querySelectorAll('a')).filter(a => {
          const text = (a.innerText || '').trim().toLowerCase();
          return text.includes('click for more') || text === 'more information';
        });

        for (const infoLink of infoLinks) {
          const detailUrl = infoLink.href;

          let container = infoLink.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!container) break;
            const text = container.innerText || '';
            if (text.includes('Event Location') && text.includes('Time:')) break;
            container = container.parentElement;
          }
          if (!container) continue;

          const containerText = container.innerText || '';

          const titleAnchor = Array.from(container.querySelectorAll('a')).find(a =>
            a !== infoLink &&
            (a.innerText || '').trim().length > 5 &&
            !(a.innerText || '').toLowerCase().includes('click for more')
          );
          const title = titleAnchor ? (titleAnchor.innerText || '').trim() : '';
          const sourceUrl = titleAnchor ? titleAnchor.href : detailUrl;

          const dateMatch = containerText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+\w+ \d+,\s+\d{4}/);
          const rawDate = dateMatch ? dateMatch[0] : '';

          const timeMatch = containerText.match(/Time:\s*([^\n]+)/);
          const rawTime = timeMatch ? timeMatch[1].trim() : '';

          const locationMatch = containerText.match(/Event Location:\s*([^\n]+)/);
          const location = locationMatch ? locationMatch[1].trim() : '';

          if (title) results.push({ title, sourceUrl, detailUrl, rawDate, rawTime, location });
        }

        return results;
      });

      for (const e of dayEvents) {
        if (isNonEvent(e.title) || seen.has(e.title)) continue;
        seen.add(e.title);
        filtered.push(e);
      }
    }

    console.log(`Found ${filtered.length} events — fetching full descriptions...`);
    onProgress('scraping', days.length, days.length, `Found ${filtered.length} events — loading details...`);

    // Pass 2: visit each detail page for the full description
    const detailPage = await context.newPage();
    const events = [];

    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i];
      console.log(`  ${e.title.substring(0, 60)}`);
      onProgress('scraping', i + 1, filtered.length, `Reading: ${e.title.substring(0, 50)}`);
      const { description, externalUrl } = await scrapeFullDescription(detailPage, e.detailUrl || e.sourceUrl);
      events.push({
        id: generateId(),
        title: e.title,
        sourceUrl: externalUrl || e.detailUrl || e.sourceUrl,
        rawDate: e.rawDate,
        rawTime: e.rawTime,
        location: e.location,
        description,
      });
    }

    console.log(`Done. ${events.length} events scraped.`);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(path.join(DATA_DIR, 'events-raw.json'), JSON.stringify(events, null, 2));

    return events;
  } finally {
    await browser.close();
  }
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scrapeEvents()
    .then(events => {
      console.log(JSON.stringify(events, null, 2));
      console.log(`\nTotal: ${events.length} events`);
    })
    .catch(err => {
      console.error('Scrape failed:', err.message);
      process.exit(1);
    });
}
