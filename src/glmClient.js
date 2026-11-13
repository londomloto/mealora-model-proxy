const config = require('./config');
const { createOpenAICompatClient, parseJsonText } = require('./openaiCompatClient');

// GLM (Zhipu / Z.ai): JSON mode only, so the schema goes in the prompt and is
// validated locally. Thinking is disabled to keep latency down.
const client = createOpenAICompatClient({
  name: 'GLM',
  baseUrl: config.glmBaseUrl,
  apiKey: config.glmApiKey,
  imageModel: config.glmModel,
  textModel: config.glmTextModel,
  schemaMode: 'json_mode',
  extraBody: { thinking: { type: 'disabled' } },
  defaultTimeoutMs: config.providerTimeoutMs,
});

module.exports = { ...client, _test: { ...client._test, parseJsonText } };
