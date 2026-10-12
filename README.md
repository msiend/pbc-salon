# Raju Riyaz Unisex Salon

A lightweight, server-rendered Express/EJS site for the salon in Daccapatty, Nagaon (9126691868). Node 24+ and SQLite, with no frontend build or external font requests.

## Run

```sh
npm ci
cp .env.example .env
# Edit .env: set a unique ADMIN_PASSWORD (12+ characters) and SESSION_SECRET.
node --env-file=.env server.js
```

Open port 3000. `/admin` is the management panel. Admin access remains disabled without a configured password. Production refuses to start without credentials. Generate a session secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and store it securely, never in Git.

`npm test` runs transaction, coupon and HTTP workflow tests using temporary databases. `npm run dev` runs Node watch mode; use `node --env-file=.env --watch server.js` to load local settings.

## Branding and content

The referenced chat supplied the salon name, address, telephone and an opening announcement for 16 October. The original attachments were unavailable; the site uses a typographic salon name and an abstract CSS illustration until you provide assets. It does not recreate the logo or advertise an unverified opening year. Service categories are editable starter content, with prices deliberately unset pending the actual menu.

Place the **unaltered original logo** at `public/brand/logo.png` and an optimised exterior night photo at `public/brand/exterior-night.webp`. No image is stretched; the original logo is contained. Restart to refresh asset availability. For optional music, put a legally licensed nostalgic Indian track at `public/music/song.mp3` and set `MUSIC_TITLE` to its actual title. Music is opt-in, never autoplayed, and audio is not downloaded until playback. No copyrighted recording is bundled.

## Coupons and offers

- Global allocation: 100 successful claims across all offers, enforced by SQLite `BEGIN IMMEDIATE`.
- Unique coupon codes and private 192-bit tokens. One welcome coupon per Indian mobile number across all offers.
- Server-validated form, explicit contact consent, and real 24-hour application counts.
- Up to ₹200 discount; administrator can set ₹1–₹200 and validity 1–90 days. Existing coupons retain issue-time discount and expiry. Times are stored as UTC milliseconds and displayed in India time.
- Gold SVG download embeds the logo when installed. SVG opens in a browser and can be printed or saved as PDF. It is not a photograph or PNG.
- Share buttons share the **public offer**, never the personal coupon link.
- Admin: search leads, see expiry and redemption, mark used/unused, edit service prices, create/edit/deactivate offers and export CSV. Deactivate offers rather than deleting historical records.

Confirm eligible services and final offer terms before advertising. Starter copy is a proposal, not a verified price list. Coupon claims do not reserve appointments.

## Meta Pixel

Set numeric `META_PIXEL_ID`. Cookie preference UI gates PageView, ViewContent (offers/form), Lead (successful issue) and Contact (call/WhatsApp) events. No customer name, mobile, coupon code or token is sent. The success route is session-based at `/claim/success` so private tokens are excluded from the Pixel URL. Direct private coupon pages and admin pages never initialise Pixel. Automatic event detection is disabled. Declining/revoking stops tracking; it cannot undo events already sent. Verify real ingestion with Meta Events Manager/Test Events and your live Pixel ID before launching ads. A Pixel ID and real account were not provided, so live Meta delivery is unverified. No Conversion API or invented events.

## Deployment and data

Run a **single persistent Node server** with an attached writable volume for `DB_PATH` (default `data/salon.sqlite`). SQLite is shared by devices through the backend, not browser local storage. Stateless serverless hosting or ephemeral disks are unsuitable. Back up SQLite using its backup facilities or while the server is stopped; preserve database/WAL together for live snapshots. Sessions are also stored in SQLite. No default admin password.

For deployment, set `NODE_ENV=production`, strong credentials and HTTPS at a reverse proxy; set `TRUST_PROXY` to the exact trusted hop count when necessary so secure cookies work. Configure TLS on the proxy. Never expose an untrusted proxy directly. Enable restarts via your host's process manager. Keep secrets in hosting settings; restrict DB file access. Static assets have one-day caching in production; personalised coupons/admin are `no-store`. Application responses are small HTML and CSS; no build step is needed.

Rate limits are in-process and appropriate to one server; multi-server deployments need shared limits and a different database strategy. Admin authentication uses a configured single-owner password, constant-time comparison, secure production cookies, session regeneration, CSRF tokens and rate limiting. For a larger team, use individual accounts and an audit trail as a separate enhancement. Contact the salon for data deletion; the owner should set and follow an appropriate retention policy.
