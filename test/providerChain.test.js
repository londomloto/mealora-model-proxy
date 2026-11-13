const test = require('node:test');
const assert = require('node:assert');
const { createChain, createCooldowns } = require('../src/providerChain');

class ProviderTimeoutError extends Error {}
class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function setup({ gemini, glm, deadlineMs = 1000, firstAttemptMs = 100, clock }) {
  const logs = [];
  const now = clock ? () => clock.t : Date.now;
  const cooldowns = createCooldowns({ cooldownMs: 60000, now });
  const calls = [];
  const wrap = (provider, fn) => async (args) => {
    calls.push({ provider, timeoutMs: args.timeoutMs });
    return fn(args);
  };
  const run = createChain({
    task: 'parseFoodText',
    attempts: [
      { provider: 'gemini', call: wrap('gemini', gemini) },
      { provider: 'glm', call: wrap('glm', glm) },
    ],
    deadlineMs,
    firstAttemptMs,
    providerTimeoutMs: 45000,
    cooldowns,
    ProviderTimeoutError,
    now,
    log: (e) => logs.push(e),
  });
  return { run, calls, logs };
}

const ok = (tag) => async () => ({ result: { tag }, usage: { inputTokens: 1, outputTokens: 1 } });

test('gemini success: glm never called', async () => {
  const { run, calls, logs } = setup({ gemini: ok('g'), glm: ok('z') });
  const out = await run({ text: 'x' });
  assert.deepStrictEqual(out.result, { tag: 'g' });
  assert.strictEqual(out.usage.provider, 'gemini');
  assert.deepStrictEqual(calls.map((c) => c.provider), ['gemini']);
  assert.strictEqual(logs.length, 0);
});

test('gemini 429 -> glm answers, then gemini is in cooldown', async () => {
  const { run, calls, logs } = setup({
    gemini: async () => { throw new ProviderError('quota', 429); },
    glm: ok('z'),
  });
  const out = await run({ text: 'x' });
  assert.strictEqual(out.usage.provider, 'glm');
  assert.deepStrictEqual(logs[0].fallbacks, [{ provider: 'gemini', reason: 'rate_limited' }]);

  await run({ text: 'y' });
  assert.deepStrictEqual(calls.map((c) => c.provider), ['gemini', 'glm', 'glm']);
  assert.deepStrictEqual(logs[1].fallbacks, [{ provider: 'gemini', reason: 'cooldown' }]);
});

test('gemini slow -> capped by firstAttemptMs, glm gets the rest', async () => {
  const { run, calls } = setup({
    gemini: () => new Promise(() => {}),
    glm: ok('z'),
    deadlineMs: 500,
    firstAttemptMs: 50,
  });
  const out = await run({ text: 'x' });
  assert.strictEqual(out.usage.provider, 'glm');
  assert.strictEqual(calls[0].timeoutMs, 50);
  assert.ok(calls[1].timeoutMs <= 500 - 50 + 5 && calls[1].timeoutMs > 400);
});

test('bad output / 5xx falls through; all fail -> last error rethrown', async () => {
  const { run, logs } = setup({
    gemini: async () => { throw new ProviderError('non-JSON'); },
    glm: async () => { throw new ProviderError('down', 503); },
  });
  await assert.rejects(run({ text: 'x' }), (err) => err.status === 503);
  assert.deepStrictEqual(logs[0], {
    task: 'parseFoodText',
    provider: null,
    fallbacks: [
      { provider: 'gemini', reason: 'provider_error' },
      { provider: 'glm', reason: 'upstream_5xx' },
    ],
  });
});

test('all timing out -> ProviderTimeoutError (maps to 504)', async () => {
  const hang = () => new Promise(() => {});
  const { run } = setup({ gemini: hang, glm: hang, deadlineMs: 120, firstAttemptMs: 40 });
  await assert.rejects(run({ text: 'x' }), ProviderTimeoutError);
});

test('image-style results (no usage) pass through unchanged', async () => {
  const { run } = setup({ gemini: async () => ({ components: [] }), glm: ok('z') });
  assert.deepStrictEqual(await run({ imageBuffer: Buffer.from('a') }), { components: [] });
});

test('every provider cooling -> last one still tried', async () => {
  const clock = { t: 0 };
  const { run, calls } = setup({
    clock,
    gemini: async () => { throw new ProviderError('quota', 429); },
    glm: async () => { throw new ProviderError('quota', 429); },
  });
  await assert.rejects(run({ text: 'x' }));
  await assert.rejects(run({ text: 'y' }));
  assert.deepStrictEqual(calls.map((c) => c.provider), ['gemini', 'glm', 'glm']);
});
