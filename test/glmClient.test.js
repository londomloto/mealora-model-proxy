const test = require('node:test');
const assert = require('node:assert');

process.env.PROVIDER = 'glm';
process.env.GLM_API_KEY = 'test-key';

const glm = require('../src/glmClient');
const { validate } = require('../src/schemaValidator');
const { FOOD_TEXT_PARSE_RESPONSE_SCHEMA } = require('../src/schema');

function mockFetch(content, { ok = true, status = 200 } = {}) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return {
      ok,
      status,
      text: async () => 'err',
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    };
  };
  return calls;
}

const validFoodText = { items: [{ foodName: 'nasi', quantity: 1, unit: 'piring', unitStatus: 'known' }], nonFoodRequests: [] };

test('parseFoodText returns result + usage and sends OpenAI-style body', async () => {
  const enumOk = FOOD_TEXT_PARSE_RESPONSE_SCHEMA.properties.items.items.properties.unitStatus.enum[0];
  const payload = { ...validFoodText, items: [{ ...validFoodText.items[0], unitStatus: enumOk }] };
  const calls = mockFetch('```json\n' + JSON.stringify(payload) + '\n```');
  const out = await glm.parseFoodText({ text: 'nasi sepiring' });
  assert.deepStrictEqual(out.result, payload);
  assert.deepStrictEqual(out.usage, { inputTokens: 10, outputTokens: 5 });
  assert.match(calls[0].url, /\/chat\/completions$/);
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer test-key');
  assert.deepStrictEqual(calls[0].body.response_format, { type: 'json_object' });
});

test('image routes send a base64 data URL', async () => {
  const calls = mockFetch(JSON.stringify({ components: [] }));
  await glm.recognizeFoodComponents({ imageBuffer: Buffer.from('abc'), mimeType: 'image/jpeg' });
  const img = calls[0].body.messages[0].content.find((c) => c.type === 'image_url');
  assert.strictEqual(img.image_url.url, 'data:image/jpeg;base64,YWJj');
});

test('schema violation becomes ProviderError', async () => {
  mockFetch(JSON.stringify({ items: [{ foodName: 'nasi' }] }));
  await assert.rejects(glm.parseFoodText({ text: 'x' }), glm.ProviderError);
});

test('non-JSON and HTTP errors become ProviderError', async () => {
  mockFetch('bukan json');
  await assert.rejects(glm.parseFoodText({ text: 'x' }), glm.ProviderError);
  mockFetch('', { ok: false, status: 401 });
  await assert.rejects(glm.parseFoodText({ text: 'x' }), glm.ProviderError);
});

test('validator accepts nullable and rejects bad enum', () => {
  const schema = { type: 'object', properties: { a: { type: 'number', nullable: true }, b: { type: 'string', enum: ['x'] } }, required: ['a', 'b'] };
  assert.deepStrictEqual(validate(schema, { a: null, b: 'x' }), []);
  assert.ok(validate(schema, { a: 1, b: 'y' }).length);
});
