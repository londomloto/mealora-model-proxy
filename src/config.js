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

const KNOWN_PROVIDERS = ['gemini', 'groq', 'glm'];

const defaultProvider = (process.env.PROVIDER || 'gemini').toLowerCase();
if (!KNOWN_PROVIDERS.includes(defaultProvider)) {
  throw new Error(`Invalid PROVIDER: ${defaultProvider} (expected ${KNOWN_PROVIDERS.join(' or ')})`);
}

// Ordered fallback chain, e.g. "gemini,glm". Unset -> [PROVIDER]. Unknown
// names are skipped with a warning so an old value cannot stop the server.
function providerListEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return [defaultProvider];
  const list = [];
  for (const item of raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (!KNOWN_PROVIDERS.includes(item)) {
      console.warn(`[config] ${name}: unknown provider "${item}" skipped`);
    } else if (!list.includes(item)) {
      list.push(item);
    }
  }
  if (!list.length) throw new Error(`${name} has no known providers (expected ${KNOWN_PROVIDERS.join(', ')})`);
  return list;
}

const textProviders = providerListEnv('TEXT_PROVIDERS');
const imageProviders = providerListEnv('IMAGE_PROVIDERS');
const usedProviders = new Set([...textProviders, ...imageProviders]);

const config = {
  port: intEnv('PORT', 8787),
  textProviders,
  imageProviders,
  // A provider's key is only required when it appears in a chain.
  geminiApiKey: usedProviders.has('gemini') ? requireEnv('GEMINI_API_KEY') : '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  // change 012: text parsing may use a different (faster) model; image routes
  // keep GEMINI_MODEL untouched. Falls back to GEMINI_MODEL when unset.
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  glmApiKey: usedProviders.has('glm') ? requireEnv('GLM_API_KEY') : '',
  glmBaseUrl: process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4',
  glmModel: process.env.GLM_MODEL || 'glm-4.5v',
  glmTextModel: process.env.GLM_TEXT_MODEL || process.env.GLM_MODEL || 'glm-4.5-flash',
  groqApiKey: usedProviders.has('groq') ? requireEnv('GROQ_API_KEY') : '',
  groqBaseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  // Vision model is a Groq preview model: fine as a fallback, not as primary.
  groqModel: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
  groqTextModel: process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-20b',
  proxySharedToken: process.env.PROXY_SHARED_TOKEN || '',
  maxRequestsPerDay: intEnv('MAX_REQUESTS_PER_DAY', 300),
  maxEstimatedCostUsdPerDay: floatEnv('MAX_ESTIMATED_COST_USD_PER_DAY', 5),
  estimatedCostUsdPerRequest: floatEnv('ESTIMATED_COST_USD_PER_REQUEST', 0.01),
  providerTimeoutMs: intEnv('PROVIDER_TIMEOUT_MS', 20000),
  // Chain budgets: kept below the mobile client's timeouts (text 20s,
  // image 55s). Every attempt except the last is capped so the fallback
  // still has time to answer.
  textDeadlineMs: intEnv('TEXT_DEADLINE_MS', 18000),
  textAttemptTimeoutMs: intEnv('TEXT_ATTEMPT_TIMEOUT_MS', 8000),
  imageDeadlineMs: intEnv('IMAGE_DEADLINE_MS', 50000),
  imageAttemptTimeoutMs: intEnv('IMAGE_ATTEMPT_TIMEOUT_MS', 25000),
  // How long a provider that answered 429 is skipped.
  providerCooldownMs: intEnv('PROVIDER_COOLDOWN_MS', 60000),
  maxImageBytes: intEnv('MAX_IMAGE_BYTES', 8 * 1024 * 1024),
  maxParseTextChars: intEnv('MAX_PARSE_TEXT_CHARS', 500),
  // change 020: pasted nutrition text (articles, search answers) is longer.
  maxNutritionTextChars: intEnv('MAX_NUTRITION_TEXT_CHARS', 4000),
  // change 017: null when APP_*_VERSION unset (GET /app-config -> 404).
  appConfig: loadAppConfig(process.env),
};

module.exports = config;
