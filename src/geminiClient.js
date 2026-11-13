const config = require('./config');
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

class ProviderTimeoutError extends Error {}
class ProviderError extends Error {
  // `status` is the upstream HTTP status when there was one (used by the
  // provider chain to decide cooldown); undefined for network/output errors.
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// `wrapTag` names the data-only tag around user text. It defaults to the
// change-012 tag so /parse-food-text keeps its exact prompt.
async function callGemini({
  prompt,
  responseSchema,
  imageBuffer,
  mimeType,
  userText,
  wrapTag = 'kalimat',
  model = config.geminiModel,
  timeoutMs = config.providerTimeoutMs,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          imageBuffer
            ? { inline_data: { mime_type: mimeType, data: imageBuffer.toString('base64') } }
            : { text: `<${wrapTag}>\n${userText}\n</${wrapTag}>` },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ProviderTimeoutError('Gemini request timed out');
    }
    throw new ProviderError(`Gemini request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ProviderError(`Gemini returned ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new ProviderError('Gemini response missing structured output');
  }

  const usage = {
    inputTokens: payload?.usageMetadata?.promptTokenCount ?? null,
    outputTokens: payload?.usageMetadata?.candidatesTokenCount ?? null,
  };
  try {
    return { result: JSON.parse(text), usage };
  } catch {
    throw new ProviderError('Gemini returned non-JSON output');
  }
}

async function callGeminiResult(args) {
  return (await callGemini(args)).result;
}

async function extractLabel({ imageBuffer, mimeType, timeoutMs }) {
  return callGeminiResult({
    timeoutMs,
    prompt: EXTRACTION_PROMPT,
    responseSchema: EXTRACTION_RESPONSE_SCHEMA,
    imageBuffer,
    mimeType,
  });
}

// change 011-food-photo-input, task 2.1: separate task from `extractLabel`
// (different prompt/schema), same transport, same timeout/error handling —
// reusing `image-ai-access` as-is per design.md D2.
async function recognizeFoodComponents({ imageBuffer, mimeType, timeoutMs }) {
  return callGeminiResult({
    timeoutMs,
    prompt: COMPONENT_RECOGNITION_PROMPT,
    responseSchema: COMPONENT_RECOGNITION_RESPONSE_SCHEMA,
    imageBuffer,
    mimeType,
  });
}

// change 012-voice-food-input: text-only parsing, same transport and limits.
// Only the transcript text is sent, never audio (design.md D1/D3).
async function parseFoodTextGemini({ text, timeoutMs }) {
  return callGemini({
    timeoutMs,
    prompt: FOOD_TEXT_PARSE_PROMPT,
    responseSchema: FOOD_TEXT_PARSE_RESPONSE_SCHEMA,
    userText: text,
    model: config.geminiTextModel,
  });
}

// change 020-paste-nutrition-text: free-text nutrition reading. Only text is
// sent; the same core rules as the image route (design D1/D2).
async function parseNutritionTextGemini({ text, timeoutMs }) {
  return callGemini({
    timeoutMs,
    prompt: NUTRITION_TEXT_PROMPT,
    responseSchema: NUTRITION_READING_SCHEMA,
    userText: text,
    wrapTag: 'teks',
    model: config.geminiTextModel,
  });
}

async function readNutritionImageGemini({ imageBuffer, mimeType, timeoutMs }) {
  return callGeminiResult({
    timeoutMs,
    prompt: NUTRITION_IMAGE_PROMPT,
    responseSchema: NUTRITION_READING_SCHEMA,
    imageBuffer,
    mimeType,
  });
}

module.exports = {
  parseNutritionTextGemini,
  readNutritionImageGemini,
  extractLabel,
  parseFoodTextGemini,
  recognizeFoodComponents,
  ProviderTimeoutError,
  ProviderError,
};
