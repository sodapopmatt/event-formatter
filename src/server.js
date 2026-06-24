import 'dotenv/config';
import express from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const PREVIOUS_FILE = path.join(DATA_DIR, 'events-previous.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const PORT = process.env.PORT || 3000;

// Global emitter for streaming scrape progress to SSE clients
const scrapeEmitter = new EventEmitter();
let scrapeInProgress = false;

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function readEvents() {
  try {
    const raw = await readFile(EVENTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveEvents(events) {
  await mkdir(DATA_DIR, { recursive: true });
  // Archive current run before overwriting
  try {
    const current = await readFile(EVENTS_FILE, 'utf8');
    const parsed = JSON.parse(current);
    if (parsed.length > 0) {
      await writeFile(PREVIOUS_FILE, JSON.stringify({ events: parsed, savedAt: new Date().toISOString() }, null, 2));
    }
  } catch {}
  await writeFile(EVENTS_FILE, JSON.stringify(events, null, 2));
}

async function readPrevious() {
  try {
    const raw = await readFile(PREVIOUS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { events: [], savedAt: null };
  }
}

function emit(type, data) {
  scrapeEmitter.emit('progress', { type, ...data });
}

// GET /api/scrape/stream — SSE endpoint for progress
app.get('/api/scrape/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const onProgress = (data) => send(data);
  scrapeEmitter.on('progress', onProgress);

  req.on('close', () => {
    scrapeEmitter.off('progress', onProgress);
  });
});

// POST /api/scrape — kick off scrape, stream progress via SSE
app.post('/api/scrape', async (req, res) => {
  if (scrapeInProgress) {
    return res.status(409).json({ error: 'Scrape already in progress' });
  }
  scrapeInProgress = true;
  const { startDate: startStr, endDate: endStr, formatMode } = req.body || {};
  const startDate = startStr ? new Date(startStr + 'T12:00:00') : new Date();
  const endDate = endStr ? new Date(endStr + 'T12:00:00') : startDate;
  res.json({ started: true });

  // Run async so response is sent immediately
  (async () => {
    try {
      const { scrapeEvents } = await import('./scraper.js');
      const { formatEvent } = await import('./formatter.js');

      const label = startDate.toDateString() === endDate.toDateString()
        ? startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        : `${startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
      emit('status', { message: `Loading events for ${label}...`, percent: 0 });

      const rawEvents = await scrapeEvents(startDate, endDate, (step, current, total, message) => {
        const percent = step === 'scraping'
          ? Math.round(5 + (current / total) * 40)
          : Math.round(45 + (current / total) * 50);
        emit('progress', { message, percent, current, total, step });
      });

      if (rawEvents.length === 0) {
        emit('done', { events: [], message: 'No events found — selectors may need updating.' });
        return;
      }

      if (formatMode === 'pick') {
        emit('done', { raw: true, events: rawEvents, percent: 100 });
        return;
      }

      emit('status', { message: `Found ${rawEvents.length} events. Formatting with Claude...`, percent: 45 });

      const formatted = [];
      for (let i = 0; i < rawEvents.length; i++) {
        const raw = rawEvents[i];
        const percent = Math.round(45 + ((i + 1) / rawEvents.length) * 50);
        emit('progress', {
          message: `Formatting: ${raw.title.substring(0, 50)}`,
          percent,
          current: i + 1,
          total: rawEvents.length,
          step: 'formatting',
        });
        try {
          const formattedText = await formatEvent(raw);
          formatted.push({
            id: generateId(),
            formatted: formattedText,
            source: 'web',
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error(`Failed to format "${raw.title}":`, err.message);
          emit('warning', { message: `Skipped: ${raw.title}` });
        }
      }

      await saveEvents(formatted);
      emit('done', { events: formatted, percent: 100, message: `Done — ${formatted.length} events ready.` });
    } catch (err) {
      console.error('Scrape error:', err);
      emit('error', { message: err.message });
    } finally {
      scrapeInProgress = false;
    }
  })();
});

// GET /
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// GET /api/events
app.get('/api/events', async (req, res) => {
  try {
    res.json(await readEvents());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/previous
app.get('/api/events/previous', async (req, res) => {
  try {
    res.json(await readPrevious());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/output/previous
app.get('/api/output/previous', async (req, res) => {
  try {
    const { events } = await readPrevious();
    res.type('text/plain').send((events || []).map(e => e.formatted).join('\n\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id
app.delete('/api/events/:id', async (req, res) => {
  try {
    let events = await readEvents();
    events = events.filter(e => e.id !== req.params.id);
    await saveEvents(events);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/format-selected — format a subset (or all) of events-raw.json
app.post('/api/format-selected', async (req, res) => {
  try {
    const { indices } = req.body; // array of indices, or 'all'
    const rawFile = path.join(DATA_DIR, 'events-raw.json');
    const allRaw = JSON.parse(await readFile(rawFile, 'utf8'));
    const toFormat = indices === 'all' ? allRaw : indices.map(i => allRaw[i]).filter(Boolean);

    const { formatEvent } = await import('./formatter.js');
    const formatted = [];
    for (const raw of toFormat) {
      try {
        const formattedText = await formatEvent(raw);
        formatted.push({
          id: generateId(),
          formatted: formattedText,
          source: 'web',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`Failed to format "${raw.title}":`, err.message);
      }
    }
    await saveEvents(formatted);
    res.json({ events: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/format-facebook
app.post('/api/format-facebook', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });
    const { formatFacebookEvent } = await import('./formatter.js');
    const lines = await formatFacebookEvent(text);
    res.json({ events: lines.map(line => ({ id: generateId(), formatted: line, source: 'facebook', createdAt: new Date().toISOString() })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events
app.post('/api/events', async (req, res) => {
  try {
    const newEvents = Array.isArray(req.body) ? req.body : [req.body];
    const merged = [...(await readEvents()), ...newEvents];
    await saveEvents(merged);
    res.json({ events: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/output
app.get('/api/output', async (req, res) => {
  try {
    const events = await readEvents();
    res.type('text/plain').send(events.map(e => e.formatted).join('\n\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const { startScheduler } = await import('./scheduler.js');
    startScheduler();
  } catch (err) {
    console.warn('Scheduler failed to start:', err.message);
  }
  app.listen(PORT, () => {
    console.log(`News N' Roses Events Agent running at http://localhost:${PORT}`);
  });
}

start();
