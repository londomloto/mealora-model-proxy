const config = require('./config');
const {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTION_PROMPT,
  COMPONENT_RECOGNITION_RESPONSE_SCHEMA,
  COMPONENT_RECOGNITION_PROMPT,
  FOOD_TEXT_PARSE_RESPONSE_SCHEMA,
  FOOD_TEXT_PARSE_PROMPT,
} = require('./schema');

class ProviderTimeoutError extends Error {}
class ProviderError extends Error {}

async function callGemini({ prompt, responseSchema, imageBuffer, mimeType, userText, model = config.geminiModel }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          imageBuffer
            ? { inline_data: { mime_type: mimeType, data: imageBuffer.toString('base64') } }
            : { text: `<kalimat>\n${userText}\n</kalimat>` },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.providerTimeoutMs);

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
    throw new ProviderError(`Gemini returned ${response.status}: ${detail.slice(0, 200)}`);
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

async function extractLabel({ imageBuffer, mimeType }) {
  return callGeminiResult({
    prompt: EXTRACTION_PROMPT,
    responseSchema: EXTRACTION_RESPONSE_SCHEMA,
    imageBuffer,
    mimeType,
  });
}

// change 011-food-photo-input, task 2.1: separate task from `extractLabel`
// (different prompt/schema), same transport, same timeout/error handling —
// reusing `image-ai-access` as-is per design.md D2.
async function recognizeFoodComponents({ imageBuffer, mimeType }) {
  return callGeminiResult({
    prompt: COMPONENT_RECOGNITION_PROMPT,
    responseSchema: COMPONENT_RECOGNITION_RESPONSE_SCHEMA,
    imageBuffer,
    mimeType,
  });
}

// change 012-voice-food-input: text-only parsing, same transport and limits.
// Only the transcript text is sent, never audio (design.md D1/D3).
async function parseFoodTextGemini({ text }) {
  return callGemini({
    prompt: FOOD_TEXT_PARSE_PROMPT,
    responseSchema: FOOD_TEXT_PARSE_RESPONSE_SCHEMA,
    userText: text,
    model: config.geminiTextModel,
  });
}

module.exports = {
  extractLabel,
  parseFoodTextGemini,
  recognizeFoodComponents,
  ProviderTimeoutError,
  ProviderError,
};
