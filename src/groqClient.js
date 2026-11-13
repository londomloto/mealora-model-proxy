const config = require('./config');
const { createOpenAICompatClient } = require('./openaiCompatClient');

// Groq: strict json_schema (constrained decoding) on gpt-oss and qwen models.
const client = createOpenAICompatClient({
  name: 'Groq',
  baseUrl: config.groqBaseUrl,
  apiKey: config.groqApiKey,
  imageModel: config.groqModel,
  textModel: config.groqTextModel,
  schemaMode: 'strict',
  defaultTimeoutMs: config.providerTimeoutMs,
});

module.exports = client;
