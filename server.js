/**
 * SevenRooms Booking API
 *
 * Reverse-engineered SevenRooms widget API proxy.
 * No browser required — pure HTTP, ~400-900ms end-to-end.
 *
 * Endpoints:
 *   GET  /health              — liveness check
 *   GET  /venues              — list configured venues
 *   POST /check-availability  — get bookable time slots
 *   POST /book                — hold + confirm a reservation
 */

import express from 'express';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_HTML = readFileSync(join(__dirname, 'docs.html'), 'utf8');

const app = express();
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────

const API_KEY = process.env.API_KEY;
const PORT    = process.env.PORT || 3000;
const SR_BASE = 'https://www.sevenrooms.com';

if (!API_KEY) {
  console.error('FATAL: API_KEY environment variable is not set');
  process.exit(1);
}

// ── Venue registry — all Dishoom locations ────────────────────────────────────

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

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const xkey  = req.headers['x-api-key']     || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : xkey.trim();
  if (!token || token !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — provide a valid Bearer token or X-Api-Key header' });
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** YYYY-MM-DD  →  MM-DD-YYYY (SevenRooms format) */
function toSRDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

/**
 * X-Checkout-Hash: SHA-256("firstname|lastname")
 * SevenRooms uses this as a lightweight bot-check on the booking endpoint.
 */
function checkoutHash(firstName, lastName) {
  const raw = `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`;
  return createHash('sha256').update(raw).digest('hex');
}

const SR_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'application/json, text/plain, */*',
  'Referer':    `${SR_BASE}/explore/`,
  'Origin':     SR_BASE,
};

async function srFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const url  = path.startsWith('http') ? path : `${SR_BASE}${path}`;
  const opts = { method, headers: { ...SR_HEADERS, ...headers } };
  if (body) opts.body = body;
  return fetch(url, opts);
}

// ── GET / (docs page) ─────────────────────────────────────────────────────────

app.get('/', (_, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(DOCS_HTML);
});

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── GET /venues ───────────────────────────────────────────────────────────────

app.get('/venues', requireAuth, (_, res) => {
  res.json({
    venues: Object.entries(VENUES).map(([id, v]) => ({
      id, name: v.name, city: v.city, address: v.address,
    })),
  });
});

// ── POST /check-availability ──────────────────────────────────────────────────

app.post('/check-availability', requireAuth, async (req, res) => {
  const { venue: venueId, date, party_size, time } = req.body;

  // Validate
  const errs = [];
  if (!venueId)    errs.push('venue (string, e.g. "dishoom-manchester")');
  if (!date)       errs.push('date (YYYY-MM-DD)');
  if (!party_size) errs.push('party_size (integer)');
  if (errs.length) return res.status(400).json({ error: `Missing required fields: ${errs.join(', ')}` });

  const venue = VENUES[venueId];
  if (!venue) {
    return res.status(400).json({
      error:            `Unknown venue "${venueId}"`,
      available_venues: Object.keys(VENUES),
    });
  }

  const srDate = toSRDate(date);
  const params = new URLSearchParams({
    venue:              venue.urlKey,
    party_size:         String(party_size),
    halo_size_interval: '100',
    num_days:           '1',
    channel:            'SEVENROOMS_WIDGET',
    exclude_pdr:        'true',
    start_date:         srDate,
  });

  try {
    const r    = await srFetch(`/api-yoa/availability/ng/widget/range?${params}`);
    const data = await r.json();

    if (data.status !== 200) {
      return res.status(502).json({ error: 'SevenRooms upstream error', detail: data });
    }

    // Flatten all bookable slots
    const shifts   = data.data?.availability?.[date] || [];
    const allTimes = [];

    for (const shift of shifts) {
      for (const slot of shift.times) {
        if (slot.type !== 'book') continue;  // 'request' = waitlist, skip

        // Optional ±2h window filter
        if (time) {
          const pref = parseInt(time.replace(':', ''), 10);
          const st   = parseInt(slot.time.replace(':', ''), 10);
          if (Math.abs(st - pref) > 200) continue;
        }

        allTimes.push({
          time:                 slot.time,
          time_iso:             slot.time_iso,
          access_persistent_id: slot.access_persistent_id,
          shift_persistent_id:  shift.shift_persistent_id,
          shift_name:           shift.name,
        });
      }
    }

    res.json({
      available_times: allTimes,
      date,
      party_size:  Number(party_size),
      venue_name:  venue.name,
      venue_id:    venueId,
      message: allTimes.length === 0
        ? 'No availability for the requested criteria'
        : `${allTimes.length} slot(s) available`,
    });

  } catch (err) {
    console.error('[check-availability]', err);
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
});

// ── POST /book ────────────────────────────────────────────────────────────────

app.post('/book', requireAuth, async (req, res) => {
  const {
    venue:                venueKey,
    date,
    time,
    party_size,
    access_persistent_id,
    shift_persistent_id,
    first_name,
    last_name,
    email,
    phone,
    phone_dial_code    = '44',
    phone_country_code = 'GB',
  } = req.body;

  // Validate
  const missing = [];
  if (!venueKey)             missing.push('venue');
  if (!date)                 missing.push('date (YYYY-MM-DD)');
  if (!time)                 missing.push('time (HH:MM)');
  if (!party_size)           missing.push('party_size');
  if (!access_persistent_id) missing.push('access_persistent_id');
  if (!shift_persistent_id)  missing.push('shift_persistent_id');
  if (!first_name)           missing.push('first_name');
  if (!last_name)            missing.push('last_name');
  if (!email)                missing.push('email');
  if (!phone)                missing.push('phone');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const venue = VENUES[venueKey];
  if (!venue) {
    return res.status(400).json({ error: `Unknown venue "${venueKey}"` });
  }

  const srDate = toSRDate(date);

  // ── Step 1: Place a 5-minute hold on the slot ─────────────────────────────
  let holdId;
  try {
    const holdRes = await srFetch('/api-yoa/dining/hold/add', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        access_persistent_id,
        party_size:          Number(party_size),
        date,
        shift_persistent_id,
        channel:             'SEVENROOMS_WIDGET',
        time,
        venue:               venue.venueId,
      }),
    });

    const holdData = await holdRes.json();

    if (holdData.status !== 200) {
      return res.status(409).json({
        error:  'Slot no longer available — please call /check-availability again',
        detail: holdData,
      });
    }

    holdId = holdData.data.reservation_hold_id;
    console.log(`[book] Hold placed: ${holdId} (venue: ${venue.name}, time: ${date} ${time})`);

  } catch (err) {
    console.error('[book] hold/add failed:', err);
    return res.status(500).json({ error: 'Failed to hold slot', detail: err.message });
  }

  // ── Step 2: Submit the booking ────────────────────────────────────────────
  try {
    // SevenRooms wants the local number format (e.g. 07869767467 for UK, not 7869767467)
    // Strip the international prefix but preserve the local trunk digit (leading 0)
    const cleanPhone = phone.startsWith('+')
      ? '0' + phone.replace(/^\+\d{1,3}/, '').replace(/\D/g, '')
      : phone.replace(/\D/g, '');

    const form = new FormData();
    const fields = {
      // Slot identifiers
      reservation_hold_id:  holdId,
      shift_persistent_id,
      access_persistent_id,
      channel:              'SEVENROOMS_WIDGET',
      venue:                venue.venueId,
      // Booking details
      party_size:           String(party_size),
      date:                 srDate,
      time,
      selected_upsells:     JSON.stringify({ selected_inventories: [], selected_categories: [] }),
      // Guest details
      first_name,
      last_name,
      email,
      phone_number:         cleanPhone,
      dial_code:            String(phone_dial_code),
      country_code:         phone_country_code,
    };

    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null && v !== '') form.append(k, v);
    }

    const hash    = checkoutHash(first_name, last_name);
    const bookRes = await srFetch(`/booking/dining/widget/${venue.venueId}/book`, {
      method:  'POST',
      headers: {
        'X-Checkout-Hash': hash,
        'X-Widget-Origin': 'new-widget',
      },
      body: form,
    });

    const bookData = await bookRes.json();

    if (!bookRes.ok || bookData.errors) {
      console.error('[book] booking failed:', bookData);
      return res.status(409).json({
        error:  'Booking rejected by SevenRooms',
        detail: bookData.errors || bookData,
      });
    }

    const d = bookData.data || bookData;
    const confirmation = d.reference_code || d.confirmation_num || d.id || holdId;

    console.log(`[book] Confirmed: ${confirmation} — ${venue.name} ${date} ${time} party of ${party_size}`);

    res.json({
      success:          true,
      confirmation_num: confirmation,
      reservation_id:   d.id || d.actual_id || null,
      date,
      time,
      party_size:       Number(party_size),
      venue_name:       venue.name,
      venue_address:    venue.address,
      guest_name:       `${first_name} ${last_name}`,
      message:          `Reservation confirmed at ${venue.name} on ${date} at ${time} for ${party_size} guest${party_size > 1 ? 's' : ''}`,
    });

  } catch (err) {
    console.error('[book] submit failed:', err);
    res.status(500).json({ error: 'Booking request failed', detail: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`SevenRooms API running on port ${PORT}`);
  console.log(`Venues configured: ${Object.keys(VENUES).join(', ')}`);
  console.log(`API key auth: ✓`);
});
