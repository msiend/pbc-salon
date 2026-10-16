# Raju Reyaz Unisex Salon

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

## Design, links and services

The website uses locally hosted Nunito (rounded variable font, SIL Open Font License included), with the supplied palette: black `#151515`, salon red `#b91c29`, champagne `#e8c98e`, and warm ivory `#f8f5ef`. There is no frontend build or external font request.

`/links` is the mobile Link Page (`/link` redirects there). It includes the exact Google Maps, Instagram and Facebook URLs supplied by the owner, plus Claim Offer and telephone links. Standard HTTPS Maps links hand off to the Google Maps app when the device supports it and otherwise open its website.

The services from the supplied poster are Hair Styling, Trendy Haircuts, Skin Care & Facials, Waxing & Grooming, Makeup Services, Hair Spa & Treatments, Manicure & Pedicure and Hydra Facial. Prices remain unset until the salon enters them. The address is 1st Floor, Haque Market, Daccapatty, Nagaon, Assam. Previously edited service prices are preserved during the one-time service migration.

## Original logo and photos

The inline images in the chat were visible for reference, but their original files were not exposed to the execution workspace. A typographic brand fallback is shown until the actual image is installed; it is not a recreation of the original logo.

In `/admin`, use **Salon logo → Upload logo** to upload the original PNG, JPG or WebP directly (maximum 5 MB / 16 megapixels). It requires admin authentication and CSRF protection. Original image bytes are retained in SQLite. A display copy removes white outer margins and preserves aspect ratio. The logo appears in the header, footer, Link Page, coupon page and PNG downloads immediately. Uploaded originals are not publicly served.

Alternatively, place the original at `public/brand/logo.png` (`webp`, `jpg` and `jpeg` are also accepted). An uploaded logo takes precedence. Optional original salon photos go in `public/brand/` as `exterior-night`, `exterior-day`, and `interior`, with those same extensions. Photo sections appear only when files are available. No stock photos are presented as this salon.

For optional music, put a licensed track at `public/music/song.mp3` and set `MUSIC_TITLE`. Playback is opt-in, never autoplayed. No copyrighted recording is bundled.

## Claim and reward flow

1. `/claim` collects full name, Indian mobile number, service, preferred visit date and contact/WhatsApp consent. Invalid submissions retain entered values. The visit date must be a real date from today through the coupon expiry date, using India time.
2. A successful claim atomically stores the lead, a unique coupon, a cryptographically random integer **₹100–₹150 inclusive**, and the WhatsApp queue entry. Client-submitted discount amounts are ignored. One coupon per mobile; the global 100-claim limit remains transactional.
3. `/claim/success` reveals the saved amount with a short number animation. The animation cannot choose a different result. Refreshes do not reroll; reduced-motion users and browsers without JavaScript receive the saved result directly. Animation numbers are decorative and not separate awards.
4. The customer can download an actual **1080 × 1350 PNG** generated server-side by Sharp. The file includes their awarded amount, name, code, expiry, preferred visit date, terms and the installed logo. Sharing uses the public offer URL rather than personal coupon links.

The Link Page highlights welcome promotions up to ₹200 as requested, while prominently stating this spin awards ₹100–₹150. Existing coupons retain their original discount, expiry, redemption state and legacy timeframe. New coupons expire at the end of the validity date in India time. Admin validity settings apply to future claims; random award bounds are fixed at ₹100–₹150.

Admin records include the preferred visit date, actual award, claim timestamp (displayed in IST), expiry and WhatsApp request status. CSV export includes UTC ISO timestamps and the preferred visit date. Existing search, redemption, offer management and service-price controls remain available. Claiming a coupon does not confirm an appointment.

Database schema upgrades are additive and idempotent; the database is never reset. `npm test` covers new and legacy data, invalid dates, award bounds, tampering, duplicate claims, cap, PNG output, admin access, logo upload, exports, restart persistence and WhatsApp queue behavior. Test servers explicitly disable live WhatsApp sending.

## Meta Pixel

Set numeric `META_PIXEL_ID`. Cookie preference UI gates PageView, ViewContent (offers/form), Lead (successful issue) and Contact (call/WhatsApp) events. No customer name, mobile, coupon code or token is sent. The success route is session-based at `/claim/success` so private tokens are excluded from the Pixel URL. Direct private coupon pages and admin pages never initialise Pixel. Automatic event detection is disabled. Declining/revoking stops tracking; it cannot undo events already sent. Verify real ingestion with Meta Events Manager/Test Events and your live Pixel ID before launching ads. A Pixel ID and real account were not provided, so live Meta delivery is unverified. No Conversion API or invented events.

## Deployment and data

Run a **single persistent Node server** with an attached writable volume for `DB_PATH` (default `data/salon.sqlite`). SQLite is shared by devices through the backend, not browser local storage. Stateless serverless hosting or ephemeral disks are unsuitable. Back up SQLite using its backup facilities or while the server is stopped; preserve database/WAL together for live snapshots. Sessions are also stored in SQLite. No default admin password.

For deployment, set `NODE_ENV=production`, strong credentials and HTTPS at a reverse proxy; set `TRUST_PROXY` to the exact trusted hop count when necessary so secure cookies work. Configure TLS on the proxy. Never expose an untrusted proxy directly. Enable restarts via your host's process manager. Keep secrets in hosting settings; restrict DB file access. Static assets have one-day caching in production; personalised coupons/admin are `no-store`. Application responses are small HTML and CSS; no build step is needed.

Rate limits are in-process and appropriate to one server; multi-server deployments need shared limits and a different database strategy. Admin authentication uses a configured single-owner password, constant-time comparison, secure production cookies, session regeneration, CSRF tokens and rate limiting. For a larger team, use individual accounts and an audit trail as a separate enhancement. Contact the salon for data deletion; the owner should set and follow an appropriate retention policy.

## Automatic WhatsApp coupon confirmations

The lead form now explicitly asks for consent to a WhatsApp confirmation. A successful claim records a message in SQLite **in the same transaction as the coupon**. The existing background worker sends the actual stored award in template parameter 3 and sends it using Meta's official WhatsApp Cloud API without delaying the form response. Previously collected leads are not backfilled or contacted automatically. No WhatsApp marketing campaigns are added.

Configure these together in secure hosting environment settings or the ignored `.env` file:

- `WHATSAPP_ACCESS_TOKEN`: a Meta access token authorised for your WhatsApp Business phone (`whatsapp_business_messaging`). Keep it secret.
- `WHATSAPP_PHONE_NUMBER_ID`: Meta's phone number **ID**, not the salon telephone number.
- `WHATSAPP_TEMPLATE_NAME`: an approved template name, e.g. `salon_coupon_confirmation`.
- `WHATSAPP_TEMPLATE_LANGUAGE`: exact approved language code; defaults to `en`.
- `WHATSAPP_API_VERSION`: a supported Graph API version; defaults to `v23.0`.
- `PUBLIC_BASE_URL`: the real HTTPS website origin, without a path, query or credentials.

Create an approved template with **five positional body text parameters**, in this order: customer name, coupon code, stored discount amount as a number, expiry date, complete private coupon URL. Example body:

> Hello {{1}}, your Raju Reyaz Unisex Salon coupon is ready! Code: {{2}}. Your coupon is worth ₹{{3}} off eligible services. Valid until {{4}}. View and download: {{5}}. Visit Daccapatty, Nagaon or call 9126691868. Single use. Terms and conditions apply.

Use the category required by Meta for this promotional coupon content (normally marketing); obtain approval rather than assuming a utility classification. This implementation expects a body-only template with no required header or button parameters. Website submissions do not open a WhatsApp conversation window, so an approved template is required for the first business-initiated message. In Meta's test environment, recipients must be added/verified as test recipients; production needs an enabled sender and the necessary account setup.

Allow outbound HTTPS to `graph.facebook.com`. Restart the server after configuration. Missing configuration leaves messages pending without attempting delivery. Non-expired pending messages resume after restart. The admin lead table displays `pending`, `accepted`, `failed` or `unknown`. **Accepted means Meta returned a message ID, not that the customer received/read the message.** Delivery/read status webhooks are not implemented.

Rate-limited requests retry after a minute, with at most three attempts. Confirmed rejections can be retried using the admin button after correcting configuration. Network timeouts, server errors and interrupted requests are marked unknown and are not automatically resent, since Meta may already have accepted them. Check Meta before any manual resend. Expired coupons are not sent. This avoids misleading success claims and repeated automatic messages.

`npm test` covers template parameters, consent-based queuing, duplicate suppression, API rejection, timeouts, rate limits, missing configuration, interrupted requests and expiry, using mocked API responses. No live messages are sent by tests. Verify one real opted-in submission with your approved template before launching; live delivery is not verified without credentials.
