# mealora-model-proxy

Minimal inference-only proxy for Mealora's AI model calls — nutrition label
extraction (`openspec/changes/010-nutrition-label-extraction` in
`mealora-plans`) and food photo component recognition
(`openspec/changes/011-food-photo-input`). It holds the Gemini API key
server-side so it never ships inside the Mealora mobile app.

Scope is deliberately narrow: receive one image, call Gemini, return
structured JSON. It stores nothing — no images, no results, no user
identity, no accounts. See `docs/inference-proxy.md` in `mealora-plans` for the
full design rationale and limits.

## Endpoints

- `POST /extract-label` — multipart form, field `image` (jpeg/png, ≤ `MAX_IMAGE_BYTES`).
  Optional header `X-Proxy-Token` when `PROXY_SHARED_TOKEN` is set.
  Responses:
  - `200` — extraction JSON (see `src/schema.js`)
  - `400` — `{ "error": "INVALID_IMAGE" }`
  - `401` — `{ "error": "UNAUTHORIZED" }` (shared token mismatch)
  - `413` — `{ "error": "INVALID_IMAGE" }` (too large)
  - `429` — `{ "error": "LIMIT_EXCEEDED" }` (daily request/cost cap hit)
  - `502` — `{ "error": "PROVIDER_ERROR" }`
  - `504` — `{ "error": "PROVIDER_TIMEOUT" }`
- `POST /recognize-food-components` — same request/response shape as
  `/extract-label`, field `image`; returns proposed food components (see
  `src/schema.js`), change 011.
- `POST /parse-food-text` — JSON `{ "text": "..." }` (≤ `MAX_PARSE_TEXT_CHARS`), change 012.
  Transcript text only, never audio. Returns proposed food items with amount and unit
  (see `src/schema.js`), never nutrition. Uses `GEMINI_TEXT_MODEL` (falls back to `GEMINI_MODEL`). Extra error:
  `400 { "error": "INVALID_TEXT" }`.
- `GET /app-config` — public app version config (change 017), **no token, no
  model rate limit**. Response:
  `{ "latestVersion", "minSupportedVersion", "releaseNotes", "storeUrl": { "android", "ios" } }`
  (whitelisted fields only). `404 { "error": "APP_CONFIG_UNSET" }` when
  `APP_LATEST_VERSION`/`APP_MIN_SUPPORTED_VERSION` are both empty; the app then
  stays fail-open. The server refuses to start on an invalid version format,
  min > latest, or a non-`https` store URL.

  ```bash
  curl -i http://localhost:8787/app-config
  ```

  Release procedure:
  - On every app version bump, set `APP_LATEST_VERSION` (no build number) and
    `APP_RELEASE_NOTES` — but only once the build is live in the stores.
  - Change `APP_MIN_SUPPORTED_VERSION` only deliberately: every older app is
    blocked until it updates. Rollback = lower it (or empty both versions) and redeploy.
  - Leave `APP_STORE_URL_IOS` empty until the iOS app is published; iOS then
    shows no update UI.
- `GET /health` — liveness + current day's usage counters.

The mobile client maps every error code to the same plain-language,
no-jargon "reading unavailable, use manual entry" message required by the
`image-ai-access` spec — it never shows these codes to the user directly.

## Local run

```bash
cp .env.example .env
# edit .env, set GEMINI_API_KEY
npm install
npm start
```

## Deploy to the existing droplet

```bash
cp .env.example .env
# edit .env, set GEMINI_API_KEY and PROXY_SHARED_TOKEN
docker compose up -d --build
```

If nginx/Caddy already runs on the droplet, drop the `ports:` mapping in
`docker-compose.yml` and point the existing reverse proxy's upstream at
`mealora-model-proxy:8787` on the shared Docker network instead of
exposing the port directly.

### Without Docker (pm2)

Production currently runs this way: Node via nvm + pm2, reverse-proxied by
Nginx Proxy Manager at `https://cms.koorva.com/mealora` (custom location
`/mealora/` → port 8787, forward host ends with `/` so the prefix is stripped).

First install:

```bash
git clone https://github.com/londomloto/mealora-model-proxy.git
cd mealora-model-proxy
npm ci --omit=dev
cp .env.example .env && chmod 600 .env
# edit .env, set GEMINI_API_KEY and PROXY_SHARED_TOKEN (openssl rand -hex 32)
npm i -g pm2
pm2 start src/server.js --name mealora-model-proxy
pm2 save
pm2 startup   # registers pm2-root systemd service so it survives reboot
```

Update:

```bash
git pull && npm ci --omit=dev && pm2 restart mealora-model-proxy
```

After editing `.env`:

```bash
pm2 restart mealora-model-proxy --update-env
```

Useful:

```bash
pm2 status
pm2 logs mealora-model-proxy --lines 100
curl -s localhost:8787/health
```

## What this is not

No database, no auth/accounts, no sync, no image or result storage. If any of
that is ever needed, it belongs in a different, explicitly scoped service —
not grafted onto this one. See `design.md` D2 in the 010 change for why.
