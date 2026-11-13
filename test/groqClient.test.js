const test = require('node:test');
const assert = require('node:assert');

process.env.TEXT_PROVIDERS = 'groq';
process.env.IMAGE_PROVIDERS = 'groq';
process.env.GROQ_API_KEY = 'test-key';

const groq = require('../src/groqClient');
const { toStrictSchema, stripStrictNulls } = require('../src/strictSchema');
const { validate } = require('../src/schemaValidator');
const schemas = require('../src/schema');

function mockFetch(content) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    };
  };
  return calls;
}

// Strict mode rules: every object lists all properties as required and
// forbids extra ones; enums that allow null include null.
function assertStrict(s, path = '$') {
  if (s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'))) {
    assert.strictEqual(s.additionalProperties, false, `${path} additionalProperties`);
    assert.deepStrictEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path} required`);
    for (const [k, v] of Object.entries(s.properties)) assertStrict(v, `${path}.${k}`);
  }
  if (s.items) assertStrict(s.items, `${path}[]`);
  if (s.enum && Array.isArray(s.type) && s.type.includes('null')) assert.ok(s.enum.includes(null), `${path} enum null`);
  assert.ok(!('nullable' in s), `${path} has no Gemini 'nullable'`);
}

test('every response schema converts to valid strict json_schema', () => {
  for (const name of [
    'EXTRACTION_RESPONSE_SCHEMA',
    'COMPONENT_RECOGNITION_RESPONSE_SCHEMA',
    'FOOD_TEXT_PARSE_RESPONSE_SCHEMA',
    'NUTRITION_READING_SCHEMA',
  ]) {
    assertStrict(toStrictSchema(schemas[name]), name);
  }
});

test('optional non-nullable fields: forced nulls are stripped back out', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number', nullable: true }, c: { type: 'string' } },
    required: ['a', 'b'],
  };
  const out = stripStrictNulls(schema, { a: 'x', b: null, c: null });
  assert.deepStrictEqual(out, { a: 'x', b: null });
  assert.deepStrictEqual(validate(schema, out), []);
});

test('groq text call sends strict json_schema to the text model', async () => {
  const unitStatus = schemas.FOOD_TEXT_PARSE_RESPONSE_SCHEMA.properties.items.items.properties.unitStatus.enum[0];
  const answer = { items: [{ foodName: 'nasi', quantity: 1, unit: 'piring', unitStatus }], nonFoodRequests: [] };
  const calls = mockFetch(JSON.stringify(answer));
  const out = await groq.parseFoodText({ text: 'nasi sepiring' });
  assert.deepStrictEqual(out.result, answer);
  const body = calls[0].body;
  assert.strictEqual(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.strictEqual(body.model, 'openai/gpt-oss-20b');
  assert.strictEqual(body.response_format.type, 'json_schema');
  assert.strictEqual(body.response_format.json_schema.strict, true);
  // Strict mode does not need the schema repeated in the prompt.
  assert.ok(!body.messages[0].content[0].text.includes('JSON schema berikut'));
});

test('groq image call uses the vision model', async () => {
  const calls = mockFetch(JSON.stringify({ components: [] }));
  await groq.recognizeFoodComponents({ imageBuffer: Buffer.from('a'), mimeType: 'image/png' });
  assert.strictEqual(calls[0].body.model, 'qwen/qwen3.8-27b');
});
