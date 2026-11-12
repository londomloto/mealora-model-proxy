const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { loadAppConfig, appConfigHandler } = require('../src/appConfig');

const validEnv = {
  APP_LATEST_VERSION: '1.2.0',
  APP_MIN_SUPPORTED_VERSION: '1.0.0',
  APP_RELEASE_NOTES: 'Perbaikan bug',
  APP_STORE_URL_ANDROID: 'https://play.google.com/store/apps/details?id=x',
  APP_STORE_URL_IOS: '',
  GEMINI_API_KEY: 'secret-key',
  PROXY_SHARED_TOKEN: 'secret-token',
};

async function get(appConfig) {
  const app = express();
  app.get('/app-config', appConfigHandler(appConfig));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/app-config`);
    return { status: res.status, headers: res.headers, body: await res.json() };
  } finally {
    server.close();
  }
}

test('returns whitelisted fields only, no secrets', async () => {
  const { status, headers, body } = await get(loadAppConfig(validEnv));
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(body, {
    latestVersion: '1.2.0',
    minSupportedVersion: '1.0.0',
    releaseNotes: 'Perbaikan bug',
    storeUrl: { android: validEnv.APP_STORE_URL_ANDROID, ios: '' },
  });
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('secret'));
});

test('404 APP_CONFIG_UNSET when versions unset', async () => {
  assert.equal(loadAppConfig({}), null);
  const { status, body } = await get(null);
  assert.equal(status, 404);
  assert.deepEqual(body, { error: 'APP_CONFIG_UNSET' });
});

test('rejects min > latest (numeric compare)', () => {
  assert.throws(() => loadAppConfig({ ...validEnv, APP_MIN_SUPPORTED_VERSION: '1.10.0', APP_LATEST_VERSION: '1.9.0' }));
  assert.doesNotThrow(() => loadAppConfig({ ...validEnv, APP_MIN_SUPPORTED_VERSION: '1.9.0', APP_LATEST_VERSION: '1.10.0' }));
});

test('rejects invalid formats', () => {
  assert.throws(() => loadAppConfig({ ...validEnv, APP_LATEST_VERSION: '1.2' }));
  assert.throws(() => loadAppConfig({ ...validEnv, APP_LATEST_VERSION: '1.2.0+3' }));
  assert.throws(() => loadAppConfig({ ...validEnv, APP_MIN_SUPPORTED_VERSION: '' }));
  assert.throws(() => loadAppConfig({ ...validEnv, APP_STORE_URL_ANDROID: 'http://x' }));
});
