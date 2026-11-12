require('dotenv').config();

const { loadAppConfig } = require('./appConfig');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer for ${name}: ${raw}`);
  return parsed;
}

function floatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) throw new Error(`Invalid number for ${name}: ${raw}`);
  return parsed;
}

const config = {
  port: intEnv('PORT', 8787),
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  // change 012: text parsing may use a different (faster) model; image routes
  // keep GEMINI_MODEL untouched. Falls back to GEMINI_MODEL when unset.
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  proxySharedToken: process.env.PROXY_SHARED_TOKEN || '',
  maxRequestsPerDay: intEnv('MAX_REQUESTS_PER_DAY', 300),
  maxEstimatedCostUsdPerDay: floatEnv('MAX_ESTIMATED_COST_USD_PER_DAY', 5),
  estimatedCostUsdPerRequest: floatEnv('ESTIMATED_COST_USD_PER_REQUEST', 0.01),
  providerTimeoutMs: intEnv('PROVIDER_TIMEOUT_MS', 20000),
  maxImageBytes: intEnv('MAX_IMAGE_BYTES', 8 * 1024 * 1024),
  maxParseTextChars: intEnv('MAX_PARSE_TEXT_CHARS', 500),
  // change 020: pasted nutrition text (articles, search answers) is longer.
  maxNutritionTextChars: intEnv('MAX_NUTRITION_TEXT_CHARS', 4000),
  // change 017: null when APP_*_VERSION unset (GET /app-config -> 404).
  appConfig: loadAppConfig(process.env),
};

module.exports = config;
