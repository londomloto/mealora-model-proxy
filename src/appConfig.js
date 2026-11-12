// change 017-app-update-check: public, read-only app version config.
// Pure module (no dependency on ./config) so it can be tested without the
// Gemini env vars.

const VERSION_RE = /^\d+\.\d+\.\d+$/;

function parseVersion(value) {
  return value.split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function storeUrl(raw, name) {
  const value = (raw || '').trim();
  if (!value) return '';
  if (!value.startsWith('https://')) {
    throw new Error(`Invalid ${name}: must be an https:// URL`);
  }
  return value;
}

/**
 * Reads the app version config from env. Returns null when both version vars
 * are unset (feature disabled). Throws on any invalid value so the server
 * fails fast at start instead of serving a config that could block users.
 */
function loadAppConfig(env = process.env) {
  const latest = (env.APP_LATEST_VERSION || '').trim();
  const min = (env.APP_MIN_SUPPORTED_VERSION || '').trim();
  if (!latest && !min) return null;

  if (!VERSION_RE.test(latest)) {
    throw new Error('Invalid APP_LATEST_VERSION: expected x.y.z');
  }
  if (!VERSION_RE.test(min)) {
    throw new Error('Invalid APP_MIN_SUPPORTED_VERSION: expected x.y.z');
  }
  if (compareVersions(min, latest) > 0) {
    throw new Error('APP_MIN_SUPPORTED_VERSION must not exceed APP_LATEST_VERSION');
  }

  // Explicit whitelist: nothing else from env or server config is ever exposed.
  return Object.freeze({
    latestVersion: latest,
    minSupportedVersion: min,
    releaseNotes: env.APP_RELEASE_NOTES || '',
    storeUrl: Object.freeze({
      android: storeUrl(env.APP_STORE_URL_ANDROID, 'APP_STORE_URL_ANDROID'),
      ios: storeUrl(env.APP_STORE_URL_IOS, 'APP_STORE_URL_IOS'),
    }),
  });
}

function appConfigHandler(appConfig) {
  return (_req, res) => {
    if (!appConfig) {
      return res.status(404).json({ error: 'APP_CONFIG_UNSET' });
    }
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(appConfig);
  };
}

module.exports = { loadAppConfig, appConfigHandler, compareVersions };
