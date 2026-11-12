const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

class ProviderTimeoutError extends Error {}
class ProviderError extends Error {}

const READING = {
  sourceKind: 'general',
  foodName: 'steak daging sapi',
  basis: { kind: 'per_100g', amount: 100, unit: 'g', description: 'daging sapi matang' },
  energyKcal: { min: 214, max: 252, status: 'range' },
  proteinGrams: { min: 24, max: 27, status: 'range' },
  carbohydrateGrams: { min: 0, max: 0, status: 'read' },
  fatGrams: { min: 15, max: 15, status: 'read' },
  ignoredNutrients: ['vitamin B12'],
};

const SECRET_TEXT = 'Kalori: Sekitar 214 – 252 kkal RAHASIA-PENGGUNA';

function baseConfig(overrides = {}) {
  return {
    proxySharedToken: 'tok',
    maxImageBytes: 1024 * 1024,
    maxParseTextChars: 500,
    maxNutritionTextChars: 4000,
    appConfig: null,
    ...overrides,
  };
}

async function withApp({ models = {}, allowed = true, config } = {}, fn) {
  const calls = [];
  const record = (name, impl) => async (args) => {
    calls.push({ name, args });
    return impl(args);
  };
  const app = createApp({
    config: config ?? baseConfig(),
    rateLimiter: {
      checkAndReserve: () => ({ allowed }),
      currentUsage: () => ({}),
    },
    models: {
      extractLabel: record('extractLabel', async () => ({})),
      recognizeFoodComponents: record('recognizeFoodComponents', async () => ({})),
      parseFoodText: record('parseFoodText', async () => ({ result: { items: [] }, usage: {} })),
      parseNutritionText: record(
        'parseNutritionText',
        models.parseNutritionText ?? (async () => ({ result: READING, usage: { inputTokens: 10 } })),
      ),
      readNutritionImage: record('readNutritionImage', models.readNutritionImage ?? (async () => READING)),
    },
    ProviderTimeoutError,
    ProviderError,
  });
  const server = app.listen(0);
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const { port } = server.address();
    await fn({ base: `http://127.0.0.1:${port}`, calls, logs });
  } finally {
    console.log = origLog;
    console.error = origErr;
    server.close();
  }
}

function postText(base, path, text, token = 'tok') {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Token': token },
    body: JSON.stringify({ text }),
  });
}

function postImage(base, mime = 'image/png', token = 'tok') {
  const form = new FormData();
  form.append('image', new Blob([Buffer.from('fake-bytes')], { type: mime }), 'a.png');
  return fetch(`${base}/read-nutrition-image`, {
    method: 'POST',
    headers: { 'X-Proxy-Token': token },
    body: form,
  });
}

test('parse-nutrition-text returns the reading and logs metadata only', async () => {
  await withApp({}, async ({ base, calls, logs }) => {
    const res = await postText(base, '/parse-nutrition-text', SECRET_TEXT);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), READING);
    assert.equal(res.headers.get('x-usage-input-tokens'), '10');
    assert.equal(calls.filter((c) => c.name === 'parseNutritionText').length, 1);
    const joined = logs.join('\n');
    assert.ok(joined.includes('/parse-nutrition-text'));
    assert.ok(!joined.includes('RAHASIA-PENGGUNA'));
    assert.ok(!joined.includes('steak'));
  });
});

test('parse-nutrition-text accepts 4000 chars and rejects empty or longer text without calling the model', async () => {
  await withApp({}, async ({ base, calls }) => {
    assert.equal((await postText(base, '/parse-nutrition-text', 'a'.repeat(4000))).status, 200);
    assert.equal((await postText(base, '/parse-nutrition-text', 'a'.repeat(4001))).status, 400);
    assert.equal((await postText(base, '/parse-nutrition-text', '   ')).status, 400);
    assert.equal(calls.filter((c) => c.name === 'parseNutritionText').length, 1);
  });
});

test('multi-byte 4000-char text fits the body limit', async () => {
  await withApp({}, async ({ base }) => {
    const res = await postText(base, '/parse-nutrition-text', 'é'.repeat(4000));
    assert.equal(res.status, 200);
  });
});

test('wrong token is rejected on both new routes', async () => {
  await withApp({}, async ({ base, calls }) => {
    assert.equal((await postText(base, '/parse-nutrition-text', 'x', 'bad')).status, 401);
    assert.equal((await postImage(base, 'image/png', 'bad')).status, 401);
    assert.equal(calls.length, 0);
  });
});

test('rate limit maps to 429 without calling the model', async () => {
  await withApp({ allowed: false }, async ({ base, calls }) => {
    assert.equal((await postText(base, '/parse-nutrition-text', 'x')).status, 429);
    assert.equal((await postImage(base)).status, 429);
    assert.equal(calls.length, 0);
  });
});

test('provider timeout and error map to 504 and 502', async () => {
  await withApp(
    {
      models: {
        parseNutritionText: async () => {
          throw new ProviderTimeoutError('slow');
        },
        readNutritionImage: async () => {
          throw new ProviderError('boom');
        },
      },
    },
    async ({ base }) => {
      assert.equal((await postText(base, '/parse-nutrition-text', 'x')).status, 504);
      assert.equal((await postImage(base)).status, 502);
    },
  );
});

test('read-nutrition-image returns the reading and rejects non-images', async () => {
  await withApp({}, async ({ base, calls }) => {
    const ok = await postImage(base);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), READING);
    assert.equal((await postImage(base, 'text/plain')).status, 400);
    assert.equal(calls.filter((c) => c.name === 'readNutritionImage').length, 1);
  });
});

test('parse-food-text keeps its 500-char limit', async () => {
  await withApp({}, async ({ base }) => {
    assert.equal((await postText(base, '/parse-food-text', 'a'.repeat(500))).status, 200);
    assert.equal((await postText(base, '/parse-food-text', 'a'.repeat(501))).status, 400);
  });
});
