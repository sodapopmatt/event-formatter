let pendingFbEvents = [];
let formatMode = 'all'; // 'all' | 'pick'
let rawEvents = []; // stored after scrape in pick mode

// ── Date helpers ──────────────────────────────────────────────
function toInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekDate(dayOfWeek, referenceDate = new Date()) {
  const d = new Date(referenceDate);
  const current = d.getDay();
  let diff = dayOfWeek - current;
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function initDates() {
  const today = new Date();
  document.getElementById('date-start').value = toInputValue(today);
  document.getElementById('date-end').value = toInputValue(today);
}

function setPreset(preset) {
  const today = new Date();
  let start, end;
  if (preset === 'mon-tue') {
    start = getWeekDate(1, today); end = getWeekDate(2, today);
    if (end <= start) end.setDate(end.getDate() + 7);
  } else if (preset === 'wed-thu') {
    start = getWeekDate(3, today); end = getWeekDate(4, today);
    if (end <= start) end.setDate(end.getDate() + 7);
  } else if (preset === 'fri-sun') {
    start = getWeekDate(5, today);
    end = getWeekDate(0, today);
    if (end <= start) end.setDate(end.getDate() + 7);
  }
  document.getElementById('date-start').value = toInputValue(start);
  document.getElementById('date-end').value = toInputValue(end);
  document.querySelectorAll('.btn-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
}

document.querySelectorAll('.btn-preset').forEach(btn => btn.addEventListener('click', () => setPreset(btn.dataset.preset)));
document.getElementById('date-start').addEventListener('change', () => document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active')));
document.getElementById('date-end').addEventListener('change', () => document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active')));
initDates();

// ── Format mode toggle ────────────────────────────────────────
document.getElementById('mode-all').addEventListener('click', () => {
  formatMode = 'all';
  document.getElementById('mode-all').classList.add('active');
  document.getElementById('mode-pick').classList.remove('active');
});
document.getElementById('mode-pick').addEventListener('click', () => {
  formatMode = 'pick';
  document.getElementById('mode-pick').classList.add('active');
  document.getElementById('mode-all').classList.remove('active');
});

// ── Tabs ──────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'previous-run') loadPreviousRun();
  });
});

// ── Event classifier ──────────────────────────────────────────
function classifyEvent(e) {
  const text = (e.formatted || '').toLowerCase();
  if (/\bconcert|live music|band\b|jazz|orchestra|symphony|perform|recital|choir|blues|acoustic|ensemble|guitarist|pianist|DJ\b|music festival/i.test(text)) {
    return { label: 'Live Music', cls: 'live-music' };
  }
  if (/\bcouncil|commission|public hearing|town hall|board meeting|workshop\b|civic|election|vote\b|ordinance|city hall|agenda\b/i.test(text)) {
    return { label: 'Civic News', cls: 'civic-news' };
  }
  return { label: 'Event', cls: 'event' };
}

// ── Markdown renderer ─────────────────────────────────────────
function renderMarkdown(str) {
  return str
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// ── Status ────────────────────────────────────────────────────
function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// ── Render helpers ────────────────────────────────────────────
function eventCardsHTML(events, removable = true) {
  if (!events || events.length === 0) return `
    <div class="empty-state">
      <div class="emoji">🌹</div>
      <p>${removable ? 'No events yet. Click <strong>Scrape</strong> to get started.' : 'No previous run found.'}</p>
    </div>`;

  return events.map(e => `
    <div class="event-card" data-id="${e.id}">
      <div class="event-text">
        ${renderMarkdown(e.formatted)}
        <div class="event-meta">
          <span class="badge badge-${classifyEvent(e).cls}">${classifyEvent(e).label}</span>
        </div>
      </div>
      ${removable ? `<div class="event-actions"><button class="btn-danger remove-btn" data-id="${e.id}">Remove</button></div>` : ''}
    </div>
  `).join('');
}

function renderEvents(events) {
  document.getElementById('events-list').innerHTML = eventCardsHTML(events, true);
  setStatus(events?.length ? `${events.length} event${events.length !== 1 ? 's' : ''} loaded` : 'No events loaded');
}

// ── Output preview ────────────────────────────────────────────
async function refreshOutputPreview() {
  const res = await fetch('/api/output');
  const text = await res.text();
  const el = document.getElementById('output-preview');
  el.textContent = text;
  el.style.display = text.trim() ? 'block' : 'none';
}

// ── Previous run ──────────────────────────────────────────────
async function loadPreviousRun() {
  try {
    const res = await fetch('/api/events/previous');
    if (!res.ok) throw new Error();
    const { events, savedAt } = await res.json();

    document.getElementById('prev-events-list').innerHTML = eventCardsHTML(events, false);

    const meta = document.getElementById('prev-meta');
    if (savedAt) {
      meta.textContent = `Saved ${new Date(savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    } else {
      meta.textContent = 'No previous run saved';
    }

    const preview = document.getElementById('prev-output-preview');
    const output = (events || []).map(e => e.formatted).join('\n\n');
    preview.textContent = output;
    preview.style.display = output.trim() ? 'block' : 'none';
  } catch {
    document.getElementById('prev-events-list').innerHTML = eventCardsHTML([], false);
    document.getElementById('prev-meta').textContent = 'No previous run saved';
  }
}

// ── Raw review panel ──────────────────────────────────────────
function showRawReview(events) {
  rawEvents = events;
  const list = document.getElementById('raw-event-list');
  list.innerHTML = events.map((e, i) => `
    <label class="raw-event-row">
      <input type="checkbox" class="raw-checkbox" data-index="${i}" />
      <div class="raw-event-info">
        <div class="raw-event-title">${e.title}</div>
        <div class="raw-event-meta">${[e.rawDate, e.rawTime, e.location].filter(Boolean).join(' · ')}</div>
      </div>
    </label>
  `).join('');
  updateFormatSelectedBtn();
  document.getElementById('raw-review').classList.add('visible');
  document.getElementById('raw-review-title').textContent = `${events.length} events scraped — pick which to format`;
}

function hideRawReview() {
  document.getElementById('raw-review').classList.remove('visible');
  document.getElementById('raw-event-list').innerHTML = '';
  rawEvents = [];
}

function getSelectedIndices() {
  return [...document.querySelectorAll('.raw-checkbox:checked')].map(cb => parseInt(cb.dataset.index));
}

function updateFormatSelectedBtn() {
  const count = getSelectedIndices().length;
  const btn = document.getElementById('format-selected-btn');
  btn.textContent = `Format Selected (${count})`;
  btn.disabled = count === 0;
}

document.getElementById('raw-event-list').addEventListener('change', updateFormatSelectedBtn);

document.getElementById('raw-select-all').addEventListener('click', () => {
  const boxes = document.querySelectorAll('.raw-checkbox');
  const allChecked = [...boxes].every(b => b.checked);
  boxes.forEach(b => { b.checked = !allChecked; });
  document.getElementById('raw-select-all').textContent = allChecked ? 'Select all' : 'Deselect all';
  updateFormatSelectedBtn();
});

async function submitFormatSelected(indices) {
  const btn = document.getElementById('format-selected-btn');
  const allBtn = document.getElementById('format-all-raw-btn');
  const statusEl = document.getElementById('format-selected-status');
  btn.disabled = true;
  allBtn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Formatting...';
  statusEl.textContent = '';
  try {
    const res = await fetch('/api/format-selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indices }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Formatting failed');
    hideRawReview();
    renderEvents(data.events ?? []);
    await refreshOutputPreview();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    btn.disabled = false;
    allBtn.disabled = false;
  } finally {
    btn.innerHTML = `Format Selected (${getSelectedIndices().length})`;
  }
}

document.getElementById('format-selected-btn').addEventListener('click', () => {
  submitFormatSelected(getSelectedIndices());
});

document.getElementById('format-all-raw-btn').addEventListener('click', () => {
  submitFormatSelected('all');
});

// ── Progress bar ──────────────────────────────────────────────
function setProgress(percent, text) {
  document.getElementById('progress-bar-fill').style.width = `${percent}%`;
  document.getElementById('progress-pct').textContent = `${percent}%`;
  document.getElementById('progress-text').textContent = text;
}
function showProgress() { document.getElementById('progress-wrap').classList.add('visible'); }
function hideProgress() {
  document.getElementById('progress-wrap').classList.remove('visible');
  setProgress(0, '');
}

// ── Scrape ────────────────────────────────────────────────────
document.getElementById('scrape-btn').addEventListener('click', async () => {
  const btn = document.getElementById('scrape-btn');
  btn.disabled = true;
  btn.textContent = 'Scraping...';
  showProgress();
  setProgress(2, 'Starting...');
  setStatus('Scraping events...');

  const stream = new EventSource('/api/scrape/stream');

  stream.onmessage = async (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'progress' || data.type === 'status') {
      setProgress(data.percent ?? 0, data.message ?? '');
      setStatus(data.message ?? '');
    }

    if (data.type === 'done') {
      stream.close();
      btn.disabled = false;
      btn.textContent = 'Scrape';
      if (data.raw) {
        setProgress(100, `Scraped ${data.events?.length ?? 0} events — pick which to format`);
        setStatus(`${data.events?.length ?? 0} events scraped`);
        setTimeout(hideProgress, 1000);
        showRawReview(data.events ?? []);
      } else {
        setProgress(100, data.message || 'Done!');
        setStatus(data.message || `${data.events?.length ?? 0} events ready`);
        renderEvents(data.events ?? []);
        await refreshOutputPreview();
        setTimeout(hideProgress, 1500);
      }
    }

    if (data.type === 'error') {
      stream.close();
      hideProgress();
      setStatus(`Error: ${data.message}`);
      alert(`Scrape failed: ${data.message}`);
      btn.disabled = false;
      btn.textContent = 'Scrape';
    }
  };

  stream.onerror = () => {
    stream.close();
    hideProgress();
    setStatus('Connection lost — check that the server is running.');
    btn.disabled = false;
    btn.textContent = 'Scrape';
  };

  try {
    const startDate = document.getElementById('date-start').value;
    const endDate = document.getElementById('date-end').value;
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, formatMode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start scrape');
  } catch (err) {
    stream.close();
    hideProgress();
    setStatus(`Error: ${err.message}`);
    alert(`Scrape failed: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Scrape';
  }
});

// ── Remove (current run) ──────────────────────────────────────
document.getElementById('events-list').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('remove-btn')) return;
  const id = e.target.dataset.id;
  document.querySelector(`.event-card[data-id="${id}"]`)?.remove();
  await fetch(`/api/events/${id}`, { method: 'DELETE' });
  await refreshOutputPreview();
  const remaining = document.querySelectorAll('#events-list .event-card').length;
  if (remaining === 0) {
    document.getElementById('events-list').innerHTML = eventCardsHTML([], true);
    setStatus('No events loaded');
  } else {
    setStatus(`${remaining} event${remaining !== 1 ? 's' : ''} loaded`);
  }
});

// ── Facebook ──────────────────────────────────────────────────
document.getElementById('fb-format-btn').addEventListener('click', async () => {
  const text = document.getElementById('fb-input').value.trim();
  const errEl = document.getElementById('fb-error');
  errEl.textContent = '';
  if (!text) { errEl.textContent = 'Paste some event text first.'; return; }

  const btn = document.getElementById('fb-format-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-color:#c0395a;border-top-color:transparent"></span>Formatting...';

  try {
    const res = await fetch('/api/format-facebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Format failed');
    pendingFbEvents = data.events;
    document.getElementById('fb-preview-cards').innerHTML = data.events.map(e =>
      `<div class="fb-preview-card">${renderMarkdown(e.formatted)}</div>`).join('');
    document.getElementById('fb-preview').style.display = 'block';
  } catch (err) {
    errEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Format & Preview';
  }
});

document.getElementById('fb-add-btn').addEventListener('click', async () => {
  if (!pendingFbEvents.length) return;
  await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pendingFbEvents),
  });
  document.getElementById('fb-input').value = '';
  document.getElementById('fb-preview').style.display = 'none';
  document.getElementById('fb-preview-cards').innerHTML = '';
  pendingFbEvents = [];
  document.getElementById('fb-details').open = false;
  const res = await fetch('/api/events');
  renderEvents(await res.json());
  await refreshOutputPreview();
});

// ── Copy buttons ──────────────────────────────────────────────
async function copyOutput(endpoint, confirmId) {
  try {
    const res = await fetch(endpoint);
    const text = await res.text();
    await navigator.clipboard.writeText(text);
    const el = document.getElementById(confirmId);
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  } catch (err) {
    alert('Copy failed: ' + err.message);
  }
}

document.getElementById('copy-btn').addEventListener('click', () => copyOutput('/api/output', 'copy-confirm'));
document.getElementById('prev-copy-btn').addEventListener('click', () => copyOutput('/api/output/previous', 'prev-copy-confirm'));

// ── Init ──────────────────────────────────────────────────────
(async () => {
  const res = await fetch('/api/events');
  renderEvents(await res.json());
  await refreshOutputPreview();
})();
