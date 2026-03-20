# SevenRooms Booking API

A lightweight REST API that lets voice agents (or any code) check availability and book tables at Dishoom restaurants via SevenRooms — in under 1.5 seconds, no browser required.

Built by reverse-engineering the SevenRooms widget's internal API calls.

---

## Base URL

```
https://sevenrooms-api.railway.app
```

> See [Deployment](#deployment) to spin up your own instance.

---

## Authentication

All endpoints (except `/health`) require a Bearer token:

```http
Authorization: Bearer <API_KEY>
```

Or alternatively:
```http
X-Api-Key: <API_KEY>
```

Contact the API owner for a key.

---

## Endpoints

### `GET /health`
No auth required. Returns `200 OK` if the server is up.

```json
{ "status": "ok", "ts": "2026-03-20T17:00:00.000Z" }
```

---

### `GET /venues`
List all configured venues and their IDs.

**Response:**
```json
{
  "venues": [
    { "id": "dishoom-manchester", "name": "Dishoom Manchester", "address": "32 Bridge Street, Manchester, M3 3BT" },
    { "id": "dishoom-kings-cross", "name": "Dishoom Kings Cross", "address": "5 Stable Street, London, N1C 4AB" }
  ]
}
```

---

### `POST /check-availability`

Find available time slots at a venue.

**Request body:**
```json
{
  "venue":      "dishoom-manchester",
  "date":       "2026-03-25",
  "party_size": 4,
  "time":       "19:00"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `venue` | string | ✅ | Venue ID from `/venues` |
| `date` | string | ✅ | Date in `YYYY-MM-DD` format |
| `party_size` | integer | ✅ | Number of guests |
| `time` | string | ❌ | Preferred time `HH:MM` — filters results to ±2 hours. Omit for all available slots. |

**Response:**
```json
{
  "available_times": [
    {
      "time": "19:00",
      "time_iso": "2026-03-25 19:00:00",
      "access_persistent_id": "ahNzfn...ABC",
      "shift_persistent_id":  "ahNzfn...XYZ",
      "shift_name": "D7 Mon - Thurs"
    },
    {
      "time": "19:30",
      "time_iso": "2026-03-25 19:30:00",
      "access_persistent_id": "ahNzfn...DEF",
      "shift_persistent_id":  "ahNzfn...XYZ",
      "shift_name": "D7 Mon - Thurs"
    }
  ],
  "date": "2026-03-25",
  "party_size": 4,
  "venue_name": "Dishoom Manchester",
  "venue_id": "dishoom-manchester",
  "message": "2 slot(s) available"
}
```

> **Important:** The `access_persistent_id` and `shift_persistent_id` from this response are required to call `/book`. They encode the specific bookable slot and expire after a few hours — don't cache them for long.

---

### `POST /book`

Book a specific time slot. Internally this places a 5-minute hold on the slot and then immediately confirms the reservation.

**Request body:**
```json
{
  "venue":                "dishoom-manchester",
  "date":                 "2026-03-25",
  "time":                 "19:30",
  "party_size":           4,
  "access_persistent_id": "ahNzfn...ABC",
  "shift_persistent_id":  "ahNzfn...XYZ",

  "first_name":           "John",
  "last_name":            "Smith",
  "email":                "john@example.com",
  "phone":                "+447700900000",
  "phone_dial_code":      "44",
  "phone_country_code":   "GB"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `venue` | string | ✅ | Venue ID |
| `date` | string | ✅ | `YYYY-MM-DD` |
| `time` | string | ✅ | `HH:MM` — must match a slot from `/check-availability` |
| `party_size` | integer | ✅ | Number of guests |
| `access_persistent_id` | string | ✅ | From `/check-availability` response |
| `shift_persistent_id` | string | ✅ | From `/check-availability` response |
| `first_name` | string | ✅ | Guest first name |
| `last_name` | string | ✅ | Guest last name |
| `email` | string | ✅ | Guest email (confirmation will be sent here) |
| `phone` | string | ✅ | International format e.g. `+447700900000` |
| `phone_dial_code` | string | ❌ | Dial code without `+`, defaults to `"44"` (UK) |
| `phone_country_code` | string | ❌ | ISO 3166-1 alpha-2, defaults to `"GB"` |

**Response:**
```json
{
  "success": true,
  "confirmation_num": "ABC123",
  "reservation_id": "...",
  "date": "2026-03-25",
  "time": "19:30",
  "party_size": 4,
  "venue_name": "Dishoom Manchester",
  "venue_address": "32 Bridge Street, Manchester, M3 3BT",
  "guest_name": "John Smith",
  "message": "Reservation confirmed at Dishoom Manchester on 2026-03-25 at 19:30 for 4 guests"
}
```

---

## Typical voice agent flow

```
1. Agent collects: venue, date, time preference, party size

2. Call POST /check-availability
   → Returns list of available slots near the requested time

3. Agent reads back options to caller, caller picks one
   (e.g. "I have 19:00, 19:30 and 20:00 available — which works for you?")

4. Agent collects: first name, last name, email, phone

5. Call POST /book  (with the chosen slot's access_persistent_id + shift_persistent_id)
   → Returns confirmation number

6. Agent reads confirmation to caller
   (e.g. "You're booked! Confirmation number is ABC123. See you at Dishoom!")
```

---

## Error responses

All errors return JSON with an `error` field:

```json
{ "error": "Missing required fields: date, party_size" }
```

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad request — missing or invalid fields |
| `401` | Missing or invalid API key |
| `409` | Slot no longer available (someone else booked it) — call `/check-availability` again |
| `500` | Internal server error |
| `502` | SevenRooms upstream error |

---

## Code examples

### JavaScript / Node.js

```js
const BASE = 'https://sevenrooms-api.railway.app';
const KEY  = 'your-api-key-here';

const headers = {
  'Authorization': `Bearer ${KEY}`,
  'Content-Type':  'application/json',
};

// 1. Check availability
const avail = await fetch(`${BASE}/check-availability`, {
  method:  'POST',
  headers,
  body: JSON.stringify({
    venue:      'dishoom-manchester',
    date:       '2026-03-25',
    party_size: 4,
    time:       '19:00',
  }),
}).then(r => r.json());

console.log(avail.available_times);
// [{ time: '19:00', access_persistent_id: '...', shift_persistent_id: '...' }, ...]

// 2. Book
const slot = avail.available_times[0];

const booking = await fetch(`${BASE}/book`, {
  method:  'POST',
  headers,
  body: JSON.stringify({
    venue:                'dishoom-manchester',
    date:                 '2026-03-25',
    time:                 slot.time,
    party_size:           4,
    access_persistent_id: slot.access_persistent_id,
    shift_persistent_id:  slot.shift_persistent_id,
    first_name:           'John',
    last_name:            'Smith',
    email:                'john@example.com',
    phone:                '+447700900000',
  }),
}).then(r => r.json());

console.log(booking.message);
// "Reservation confirmed at Dishoom Manchester on 2026-03-25 at 19:00 for 4 guests"
```

### Python

```python
import requests

BASE = 'https://sevenrooms-api.railway.app'
KEY  = 'your-api-key-here'
headers = {'Authorization': f'Bearer {KEY}'}

# 1. Check availability
avail = requests.post(f'{BASE}/check-availability', headers=headers, json={
    'venue': 'dishoom-manchester',
    'date': '2026-03-25',
    'party_size': 4,
    'time': '19:00',
}).json()

slot = avail['available_times'][0]

# 2. Book
booking = requests.post(f'{BASE}/book', headers=headers, json={
    'venue': 'dishoom-manchester',
    'date': '2026-03-25',
    'time': slot['time'],
    'party_size': 4,
    'access_persistent_id': slot['access_persistent_id'],
    'shift_persistent_id':  slot['shift_persistent_id'],
    'first_name': 'John',
    'last_name':  'Smith',
    'email':      'john@example.com',
    'phone':      '+447700900000',
}).json()

print(booking['message'])
```

### curl

```bash
API_KEY="your-api-key-here"
BASE="https://sevenrooms-api.railway.app"

# Check availability
curl -s -X POST "$BASE/check-availability" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "venue": "dishoom-manchester",
    "date": "2026-03-25",
    "party_size": 4,
    "time": "19:00"
  }' | jq .
```

---

## Deployment

The server is a single `server.js` file with one dependency (`express`). Deploy anywhere Node.js runs.

### Railway (recommended — free tier)

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Deploy
cd sevenrooms-api
railway init
railway up

# 4. Set your API key
railway variables set API_KEY=your-secret-key-here

# 5. Get your URL
railway domain
```

### Docker

```bash
docker build -t sevenrooms-api .
docker run -e API_KEY=your-secret-key -p 3000:3000 sevenrooms-api
```

### Render / Fly.io / Heroku

Point at this repo, set `API_KEY` as an environment variable, and deploy. The `Dockerfile` and `railway.json` are included.

---

## Adding more venues

In `server.js`, find the `VENUES` object and add an entry:

```js
'dishoom-birmingham': {
  urlKey:  'dishoombirmingham',   // from the SevenRooms URL: /explore/{urlKey}/
  venueId: 'ahNzfn...',           // from the SevenRooms API response
  name:    'Dishoom Birmingham',
  address: '...',
},
```

The `venueId` is the opaque ID returned in the `shift_persistent_id` prefix from any `/check-availability` call. Alternatively, it appears in the `venue` field of the `hold/add` request captured via browser devtools.

---

## Notes

- The SevenRooms widget API has no official documentation — this is based on reverse engineering the widget JavaScript.
- There is no rate limiting applied by this proxy, but SevenRooms may rate-limit excessive requests. Don't poll continuously; call `/check-availability` only when a user requests it.
- The `access_persistent_id` values returned by `/check-availability` are time-sensitive. Do not cache them across sessions or reuse them after a failed `/book` attempt — call `/check-availability` again instead.
- Reservations are real. Test with a real booking and cancel via the confirmation email if needed.
