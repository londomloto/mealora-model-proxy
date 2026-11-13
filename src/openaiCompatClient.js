const { ProviderTimeoutError, ProviderError } = require('./geminiClient');
const { validate } = require('./schemaValidator');
const { toStrictSchema, stripStrictNulls } = require('./strictSchema');
const {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTION_PROMPT,
  COMPONENT_RECOGNITION_RESPONSE_SCHEMA,
  COMPONENT_RECOGNITION_PROMPT,
  FOOD_TEXT_PARSE_RESPONSE_SCHEMA,
  FOOD_TEXT_PARSE_PROMPT,
  NUTRITION_READING_SCHEMA,
  NUTRITION_TEXT_PROMPT,
  NUTRITION_IMAGE_PROMPT,
} = require('./schema');

// One client for every OpenAI-compatible chat API (GLM, Groq, ...). Exposes
// the same task names and error classes as geminiClient, so the provider
// chain and the mobile contract stay unchanged.
//
// schemaMode:
//   'strict'    -> response_format json_schema (strict: true); the provider
//                  enforces the schema (Groq gpt-oss / qwen).
//   'json_mode' -> response_format json_object + schema in the prompt (GLM).
// Either way the answer is validated against the original schema here.

function schemaInstruction(responseSchema) {
  return (
    '\n\nKembalikan HANYA satu objek JSON valid (tanpa markdown, tanpa teks lain) ' +
    'yang mematuhi JSON schema berikut. Field "nullable" boleh null; semua field ' +
    'di "required" wajib ada:\n' +
    JSON.stringify(responseSchema)
  );
}

function parseJsonText(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    // Some models wrap the object in prose; take the outermost {...}.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) throw err;
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function createOpenAICompatClient({
  name, // label in error messages, e.g. 'GLM'
  baseUrl,
  apiKey,
  imageModel,
  textModel,
  schemaMode = 'json_mode',
  extraBody = {},
  defaultTimeoutMs,
}) {
  async function call({
    prompt,
    responseSchema,
    schemaName,
    imageBuffer,
    mimeType,
    userText,
    wrapTag = 'kalimat',
    model,
    timeoutMs = defaultTimeoutMs,
  }) {
    const strict = schemaMode === 'strict';
    const content = [{ type: 'text', text: strict ? prompt : prompt + schemaInstruction(responseSchema) }];
    if (imageBuffer) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` },
      });
    } else {
      content.push({ type: 'text', text: `<${wrapTag}>\n${userText}\n</${wrapTag}>` });
    }

    const body = {
      model,
      messages: [{ role: 'user', content }],
      response_format: strict
        ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: toStrictSchema(responseSchema) } }
        : { type: 'json_object' },
      temperature: 0.1,
      ...extraBody,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new ProviderTimeoutError(`${name} request timed out`);
      throw new ProviderError(`${name} request failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(`${name} returned ${response.status}: ${detail.slice(0, 200)}`, response.status);
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new ProviderError(`${name} response missing content`);
    }

    let result;
    try {
      result = parseJsonText(text);
    } catch {
      throw new ProviderError(`${name} returned non-JSON output`);
    }
    if (strict) result = stripStrictNulls(responseSchema, result);
    const errors = validate(responseSchema, result);
    if (errors.length) {
      throw new ProviderError(`${name} output failed schema: ${errors.slice(0, 3).join('; ')}`);
    }

    return {
      result,
      usage: {
        inputTokens: payload?.usage?.prompt_tokens ?? null,
        outputTokens: payload?.usage?.completion_tokens ?? null,
      },
    };
  }

  const callResult = async (args) => (await call(args)).result;

  return {
    extractLabel: ({ imageBuffer, mimeType, timeoutMs }) =>
      callResult({
        prompt: EXTRACTION_PROMPT,
        responseSchema: EXTRACTION_RESPONSE_SCHEMA,
        schemaName: 'nutrition_label',
        imageBuffer,
        mimeType,
        model: imageModel,
        timeoutMs,
      }),
    recognizeFoodComponents: ({ imageBuffer, mimeType, timeoutMs }) =>
      callResult({
        prompt: COMPONENT_RECOGNITION_PROMPT,
        responseSchema: COMPONENT_RECOGNITION_RESPONSE_SCHEMA,
        schemaName: 'food_components',
        imageBuffer,
        mimeType,
        model: imageModel,
        timeoutMs,
      }),
    readNutritionImage: ({ imageBuffer, mimeType, timeoutMs }) =>
      callResult({
        prompt: NUTRITION_IMAGE_PROMPT,
        responseSchema: NUTRITION_READING_SCHEMA,
        schemaName: 'nutrition_reading',
        imageBuffer,
        mimeType,
        model: imageModel,
        timeoutMs,
      }),
    parseFoodText: ({ text, timeoutMs }) =>
      call({
        prompt: FOOD_TEXT_PARSE_PROMPT,
        responseSchema: FOOD_TEXT_PARSE_RESPONSE_SCHEMA,
        schemaName: 'food_text',
        userText: text,
        model: textModel,
        timeoutMs,
      }),
    parseNutritionText: ({ text, timeoutMs }) =>
      call({
        prompt: NUTRITION_TEXT_PROMPT,
        responseSchema: NUTRITION_READING_SCHEMA,
        schemaName: 'nutrition_reading',
        userText: text,
        wrapTag: 'teks',
        model: textModel,
        timeoutMs,
      }),
    ProviderTimeoutError,
    ProviderError,
    _test: { call },
  };
}

module.exports = { createOpenAICompatClient, parseJsonText };
