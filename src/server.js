const config = require('./config');
const rateLimiter = require('./rateLimiter');
const { createApp } = require('./app');
const gemini = require('./geminiClient');
const { createChain, createCooldowns } = require('./providerChain');

// Same task names on every client; gemini keeps its original function names.
const clients = {
  gemini: {
    extractLabel: gemini.extractLabel,
    recognizeFoodComponents: gemini.recognizeFoodComponents,
    readNutritionImage: gemini.readNutritionImageGemini,
    parseFoodText: gemini.parseFoodTextGemini,
    parseNutritionText: gemini.parseNutritionTextGemini,
  },
  // Loaded lazily so a gemini-only setup never touches the other clients.
  get groq() {
    return require('./groqClient');
  },
  get glm() {
    return require('./glmClient');
  },
};

const cooldowns = createCooldowns({ cooldownMs: config.providerCooldownMs });

function chainFor(task, providers, deadlineMs, firstAttemptMs) {
  return createChain({
    task,
    attempts: providers.map((provider) => ({ provider, call: clients[provider][task] })),
    deadlineMs,
    firstAttemptMs,
    providerTimeoutMs: config.providerTimeoutMs,
    cooldowns,
    ProviderTimeoutError: gemini.ProviderTimeoutError,
  });
}

const image = (task) => chainFor(task, config.imageProviders, config.imageDeadlineMs, config.imageAttemptTimeoutMs);
const text = (task) => chainFor(task, config.textProviders, config.textDeadlineMs, config.textAttemptTimeoutMs);

const app = createApp({
  config,
  rateLimiter,
  models: {
    extractLabel: image('extractLabel'),
    recognizeFoodComponents: image('recognizeFoodComponents'),
    readNutritionImage: image('readNutritionImage'),
    parseFoodText: text('parseFoodText'),
    parseNutritionText: text('parseNutritionText'),
  },
  ProviderTimeoutError: gemini.ProviderTimeoutError,
  ProviderError: gemini.ProviderError,
});

app.listen(config.port, () => {
  console.log(`mealora-model-proxy listening on :${config.port} (text: ${config.textProviders.join('>')}, image: ${config.imageProviders.join('>')})`);
});
