const config = require('./config');
const rateLimiter = require('./rateLimiter');
const { createApp } = require('./app');
const {
  extractLabel,
  recognizeFoodComponents,
  parseFoodTextGemini,
  parseNutritionTextGemini,
  readNutritionImageGemini,
  ProviderTimeoutError,
  ProviderError,
} = require('./geminiClient');

const app = createApp({
  config,
  rateLimiter,
  models: {
    extractLabel,
    recognizeFoodComponents,
    parseFoodText: parseFoodTextGemini,
    parseNutritionText: parseNutritionTextGemini,
    readNutritionImage: readNutritionImageGemini,
  },
  ProviderTimeoutError,
  ProviderError,
});

app.listen(config.port, () => {
  console.log(`mealora-model-proxy listening on :${config.port}`);
});
