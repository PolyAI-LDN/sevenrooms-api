/**
 * SevenRooms Booking API
 *
 * Architecture:
 *   /check-availability  — pure HTTP (~400ms)
 *   /book                — headless Playwright browser, warm instance reused (~1-2s)
 */

import express from 'express';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_HTML  = readFileSync(join(__dirname, 'docs.html'), 'utf8');

const app     = express();
app.use(express.json());

const API_KEY = process.env.API_KEY;
const PORT    = process.env.PORT || 3000;
const SR_BASE = 'https://www.sevenrooms.com';

if (!API_KEY) { console.error('FATAL: API_KEY not set'); process.exit(1); }

// ── Venue registry ────────────────────────────────────────────────────────────

const VENUES = {
  'dishoom-battersea': {
    urlKey:  'dishoombattersea',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgICyrfTw8gsM',
    name:    'Dishoom Battersea',
    address: 'Circus Road West, Battersea Power Station, London, SW11 8EZ',
    city:    'London',
  },
  'dishoom-carnaby': {
    urlKey:  'dishoomcarnaby',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDY67SBzgkM',
    name:    'Dishoom Carnaby',
    address: '22 Kingly Street, London, W1B 5QP',
    city:    'London',
  },
  'dishoom-canary-wharf': {
    urlKey:  'dishoomcanarywharf',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDs27aMhAgM',
    name:    'Dishoom Canary Wharf',
    address: 'Wood Wharf, 13 Water Street, London, E14 5GX',
    city:    'London',
  },
  'dishoom-covent-garden': {
    urlKey:  'dishoomcoventgarden',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDYm6uXngkM',
    name:    'Dishoom Covent Garden',
    address: "12 Upper St Martin's Lane, London, WC2H 9FB",
    city:    'London',
  },
  'dishoom-kensington': {
    urlKey:  'dishoomkensington',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDYi7-ViQkM',
    name:    'Dishoom Kensington',
    address: 'Town Hall Parade, Lyric Square, London, W6 0AT',
    city:    'London',
  },
  'dishoom-kings-cross': {
    urlKey:  'dishoomkingscross',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDYs8S2mQgM',
    name:    'Dishoom Kings Cross',
    address: '5 Stable Street, London, N1C 4AB',
    city:    'London',
  },
  'dishoom-shoreditch': {
    urlKey:  'dishoomshoreditch',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDYk7XDugoM',
    name:    'Dishoom Shoreditch',
    address: '7 Boundary Street, London, E2 7JE',
    city:    'London',
  },
  'dishoom-birmingham': {
    urlKey:  'dishoombirmingham',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDYy9Hy8gkM',
    name:    'Dishoom Birmingham',
    address: 'One Chamberlain Square, Birmingham, B3 3AX',
    city:    'Birmingham',
  },
  'dishoom-edinburgh': {
    urlKey:  'dishoomedinburgh',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDYq7fAiAoM',
    name:    'Dishoom Edinburgh',
    address: '3A St Andrew Square, Edinburgh, EH2 2BD',
    city:    'Edinburgh',
  },
  'dishoom-glasgow': {
    urlKey:  'dishoomglasgow',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDZ9qPwzQoM',
    name:    'Dishoom Glasgow',
    address: '48 St Vincent Street, Glasgow, G2 5TS',
    city:    'Glasgow',
  },
  'dishoom-manchester': {
    urlKey:  'dishoommanchester',
    venueId: 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDYi5fW1wkM',
    name:    'Dishoom Manchester',
    address: '32 Bridge Street, Manchester, M3 3BT',
    city:    'Manchester',
  },
};

// ── Playwright browser pool ───────────────────────────────────────────────────
// Single warm browser instance, reused across requests.

let _browser = null;
let _browserReady = false;

async function getBrowser() {
  if (_browser && _browserReady) return _browser;
  console.log('[browser] launching Chromium...');
  _browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  _browserReady = true;
  _browser.on('disconnected', () => { _browserReady = false; _browser = null; console.log('[browser] disconnected — will relaunch on next request'); });
  console.log('[browser] ready');
  return _browser;
}

// Pre-warm on startup (don't await — let server start immediately)
getBrowser().catch(e => console.error('[browser] warm-up failed:', e.message));

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const xkey  = req.headers['x-api-key']     || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : xkey.trim();
  if (!token || token !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSRDate(iso) { const [y,m,d] = iso.split('-'); return `${m}-${d}-${y}`; }

const SR_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'application/json, text/plain, */*',
  'Referer':    `${SR_BASE}/explore/`,
  'Origin':     SR_BASE,
};

async function srFetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${SR_BASE}${path}`;
  return fetch(url, { ...opts, headers: { ...SR_HEADERS, ...(opts.headers || {}) } });
}

// ── GET / (docs) ──────────────────────────────────────────────────────────────

app.get('/', (_, res) => { res.setHeader('Content-Type', 'text/html'); res.send(DOCS_HTML); });

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString(), browser: _browserReady }));

// ── GET /venues ───────────────────────────────────────────────────────────────

app.get('/venues', requireAuth, (_, res) => {
  res.json({ venues: Object.entries(VENUES).map(([id, v]) => ({ id, name: v.name, city: v.city, address: v.address })) });
});

// ── POST /check-availability ──────────────────────────────────────────────────

app.post('/check-availability', requireAuth, async (req, res) => {
  const { venue: venueId, date, party_size, time } = req.body;

  const errs = [];
  if (!venueId)    errs.push('venue');
  if (!date)       errs.push('date (YYYY-MM-DD)');
  if (!party_size) errs.push('party_size');
  if (errs.length) return res.status(400).json({ error: `Missing required fields: ${errs.join(', ')}` });

  const venue = VENUES[venueId];
  if (!venue) return res.status(400).json({ error: `Unknown venue "${venueId}"`, available_venues: Object.keys(VENUES) });

  const params = new URLSearchParams({
    venue: venue.urlKey, party_size: String(party_size), halo_size_interval: '100',
    num_days: '1', channel: 'SEVENROOMS_WIDGET', exclude_pdr: 'true', start_date: toSRDate(date),
  });

  try {
    const r    = await srFetch(`/api-yoa/availability/ng/widget/range?${params}`);
    const data = await r.json();
    if (data.status !== 200) return res.status(502).json({ error: 'SevenRooms upstream error', detail: data });

    const shifts   = data.data?.availability?.[date] || [];
    const allTimes = [];
    for (const shift of shifts) {
      for (const slot of shift.times) {
        if (slot.type !== 'book') continue;
        if (time) {
          const pref = parseInt(time.replace(':', ''), 10);
          const st   = parseInt(slot.time.replace(':', ''), 10);
          if (Math.abs(st - pref) > 200) continue;
        }
        allTimes.push({ time: slot.time, time_iso: slot.time_iso, access_persistent_id: slot.access_persistent_id, shift_persistent_id: shift.shift_persistent_id, shift_name: shift.name });
      }
    }
    res.json({ available_times: allTimes, date, party_size: Number(party_size), venue_name: venue.name, venue_id: venueId, message: allTimes.length === 0 ? 'No availability' : `${allTimes.length} slot(s) available` });
  } catch (err) {
    console.error('[check-availability]', err);
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
});

// ── POST /book ────────────────────────────────────────────────────────────────

app.post('/book', requireAuth, async (req, res) => {
  const {
    venue: venueKey, date, time, party_size,
    access_persistent_id, shift_persistent_id,
    first_name, last_name, email, phone,
    phone_dial_code    = '44',
    phone_country_code = 'GB',
  } = req.body;

  const missing = [];
  if (!venueKey)   missing.push('venue');
  if (!date)       missing.push('date');
  if (!time)       missing.push('time');
  if (!party_size) missing.push('party_size');
  if (!first_name) missing.push('first_name');
  if (!last_name)  missing.push('last_name');
  if (!email)      missing.push('email');
  if (!phone)      missing.push('phone');
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  const venue = VENUES[venueKey];
  if (!venue) return res.status(400).json({ error: `Unknown venue "${venueKey}"` });

  const srDate = toSRDate(date);

  // ── Book via headless browser — drive the real widget UI ────────────────────
  // We navigate to the search page, click the correct time slot, fill the
  // checkout form, and submit — exactly like a real user. This guarantees the
  // widget's own JS handles all headers/tokens correctly.

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-GB',
    });
    const page = await context.newPage();

    // Build local phone format
    const rawDigits  = phone.replace(/\D/g, '');
    const dialDigits = String(phone_dial_code).replace(/\D/g, '');
    const localPhone = rawDigits.startsWith(dialDigits)
      ? '0' + rawDigits.slice(dialDigits.length)
      : rawDigits;

    // ── 1. Load the search page ─────────────────────────────────────────────
    const [y, m, d_] = date.split('-');
    const searchUrl = `${SR_BASE}/explore/${venue.urlKey}/reservations/create?party_size=${party_size}&start_date=${date}`;
    console.log(`[book] navigating to ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // ── 2. Set party size if needed ─────────────────────────────────────────
    // Wait for availability slots to render
    await page.waitForSelector('[data-test="time-slot"], .ReactTimes__slot, button[class*="time"]', { timeout: 15000 }).catch(() => {});

    // ── 3. Intercept the booking response before clicking ───────────────────
    let bookingResult = null;
    page.on('response', async resp => {
      if (resp.url().includes('/booking/dining/widget/') && resp.url().endsWith('/book')) {
        try {
          const data = await resp.json();
          bookingResult = { status: resp.status(), data };
        } catch {
          bookingResult = { status: resp.status(), error: 'non-json' };
        }
      }
    });

    // ── 4. Click the matching time slot ────────────────────────────────────
    // Time slots are rendered as buttons with aria-label or text matching HH:MM
    const timeLabel = time; // e.g. "08:00"
    const [hh, mm]  = timeLabel.split(':');
    const hour12    = parseInt(hh) % 12 || 12;
    const ampm      = parseInt(hh) < 12 ? 'AM' : 'PM';
    const timeText12 = `${hour12}:${mm} ${ampm}`; // e.g. "8:00 AM"

    // Try various selectors the widget might use for time buttons
    const timeClicked = await page.evaluate(async ({ timeLabel, timeText12 }) => {
      const tryClick = (btn) => { btn.scrollIntoView(); btn.click(); return true; };
      // Match by exact text, aria-label, or data attribute
      for (const btn of document.querySelectorAll('button, [role="button"], [class*="time"], [class*="slot"]')) {
        const txt = (btn.textContent || '').trim();
        const aria = (btn.getAttribute('aria-label') || '').trim();
        if (txt === timeLabel || txt === timeText12 || aria.includes(timeLabel) || aria.includes(timeText12)) {
          return tryClick(btn);
        }
      }
      return false;
    }, { timeLabel, timeText12 });

    if (!timeClicked) {
      // Fallback: use accessibility tree — find any button with the time text
      const btn = page.getByRole('button', { name: new RegExp(timeLabel.replace(':', ':?')) }).first();
      const btnCount = await btn.count();
      if (btnCount > 0) await btn.click();
      else {
        await context.close();
        return res.status(409).json({ error: `Time slot ${timeLabel} not found on page — slot may no longer be available` });
      }
    }
    console.log(`[book] clicked time slot ${timeLabel}`);

    // ── 5. Wait for checkout form ───────────────────────────────────────────
    await page.waitForSelector('input[name="first_name"], input[id*="first"], input[placeholder*="first" i], input[placeholder*="First"]', { timeout: 15000 });
    console.log('[book] checkout form ready');

    // ── 6. Fill guest details ───────────────────────────────────────────────
    const fill = async (selectors, value) => {
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.count() > 0) { await el.fill(value); return; }
      }
    };

    await fill(['input[name="first_name"]', 'input[id*="first"]', 'input[placeholder*="First" i]'], first_name);
    await fill(['input[name="last_name"]',  'input[id*="last"]',  'input[placeholder*="Last" i]'],  last_name);
    await fill(['input[name="email"]',       'input[type="email"]', 'input[placeholder*="email" i]'],  email);

    // Phone: find the phone input (skip the dial code dropdown)
    const phoneInput = page.locator('input[name="phone_number"], input[type="tel"], input[placeholder*="phone" i], input[placeholder*="Phone"]').first();
    if (await phoneInput.count() > 0) await phoneInput.fill(localPhone);

    // ── 7. Submit ───────────────────────────────────────────────────────────
    const submitBtn = page.getByRole('button', { name: /submit|complete reservation|book|confirm|reserve/i }).first();
    await submitBtn.click();
    console.log('[book] form submitted');

    // ── 8. Wait for confirmation ────────────────────────────────────────────
    // Wait up to 15s for the booking response to come back
    const deadline = Date.now() + 15000;
    while (!bookingResult && Date.now() < deadline) {
      await page.waitForTimeout(300);
    }

    await context.close();

    if (!bookingResult) {
      return res.status(504).json({ error: 'Booking timed out — no response from SevenRooms' });
    }

    if (bookingResult.status !== 200 || bookingResult.data?.errors) {
      console.error('[book] failed:', JSON.stringify(bookingResult).substring(0, 300));
      return res.status(409).json({ error: 'Booking rejected', detail: bookingResult.data?.errors || bookingResult });
    }

    const bd = bookingResult.data;
    const confirmation = bd.message || bd.reference_code || bd.confirmation_num;
    console.log(`[book] confirmed: ${confirmation} — ${venue.name} ${date} ${time} party of ${party_size}`);

    res.json({
      success:          true,
      confirmation_num: confirmation,
      reservation_id:   bd.reservation_id || bd.api_reservation_id || null,
      date,
      time,
      party_size:       Number(party_size),
      venue_name:       venue.name,
      venue_address:    venue.address,
      guest_name:       `${first_name} ${last_name}`,
      message:          `Reservation confirmed at ${venue.name} on ${date} at ${time} for ${party_size} guest${party_size > 1 ? 's' : ''}`,
    });

  } catch (err) {
    console.error('[book] browser error:', err);
    res.status(500).json({ error: 'Booking failed', detail: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`SevenRooms API running on port ${PORT}`);
  console.log(`Venues: ${Object.keys(VENUES).length} configured`);
});
