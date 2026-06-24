import cron from 'node-cron';
import { writeFile, readFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

async function runScrapeAndFormat() {
  console.log(`[Scheduler] Starting scheduled scrape at ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT`);

  try {
    const { scrapeEvents } = await import('./scraper.js');
    const { formatEvent } = await import('./formatter.js');

    const rawEvents = await scrapeEvents();
    if (rawEvents.length === 0) {
      console.log('[Scheduler] No events found.');
      return;
    }

    const formatted = [];
    for (const raw of rawEvents) {
      try {
        const formattedText = await formatEvent(raw);
        formatted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          formatted: formattedText,
          source: 'pasadenanow',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`[Scheduler] Failed to format "${raw.title}":`, err.message);
      }
    }

    // Merge with existing, deduplicate by formatted text
    let existing = [];
    try {
      existing = JSON.parse(await readFile(EVENTS_FILE, 'utf8'));
    } catch {}

    const existingTexts = new Set(existing.map(e => e.formatted));
    const newEvents = formatted.filter(e => !existingTexts.has(e.formatted));
    const merged = [...existing, ...newEvents];

    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(EVENTS_FILE, JSON.stringify(merged, null, 2));

    console.log(`[Scheduler] Done. Added ${newEvents.length} new events (${merged.length} total). Open http://localhost:${process.env.PORT || 3000} to review.`);
  } catch (err) {
    console.error('[Scheduler] Error:', err.message);
  }
}

export function startScheduler() {
  // 7:00 AM Monday, Wednesday, Friday — America/Los_Angeles
  cron.schedule('0 7 * * 1,3,5', runScrapeAndFormat, {
    timezone: 'America/Los_Angeles',
  });
  console.log('[Scheduler] Cron scheduled: Mon/Wed/Fri 7:00 AM PT');
}
