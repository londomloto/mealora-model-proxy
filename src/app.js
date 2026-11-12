const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { appConfigHandler } = require('./appConfig');

// Builds the Express app. Dependencies are injectable so routes can be
// tested without the real model provider (change 020, task 1.5);
// `server.js` passes the real ones.
function createApp({ config, rateLimiter, models, ProviderTimeoutError, ProviderError }) {
  const app = express();
  app.use(cors());

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxImageBytes },
  });

  function checkSharedToken(req, res, next) {
    if (!config.proxySharedToken) return next();
    const provided = req.header('x-proxy-token');
    if (provided !== config.proxySharedToken) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    next();
  }

  // change 017: public, no shared token, no model rate limit.
  app.get('/app-config', appConfigHandler(config.appConfig));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', usage: rateLimiter.currentUsage() });
  });

  // Shared request handling for the image inference routes: multipart image
  // upload, rate-limit reservation, and provider-error-to-HTTP-status mapping.
  // Only the route name (for logging) and the model call itself differ.
  function registerVisionRoute(path, modelCall) {
    app.post(path, checkSharedToken, (req, res) => {
      upload.single('image')(req, res, async (uploadErr) => {
        if (uploadErr) {
          const tooLarge = uploadErr.code === 'LIMIT_FILE_SIZE';
          return res.status(tooLarge ? 413 : 400).json({ error: 'INVALID_IMAGE' });
        }

        if (!req.file || !req.file.mimetype?.startsWith('image/')) {
          return res.status(400).json({ error: 'INVALID_IMAGE' });
        }

        const reservation = rateLimiter.checkAndReserve();
        if (!reservation.allowed) {
          return res.status(429).json({ error: 'LIMIT_EXCEEDED' });
        }

        const startedAt = Date.now();
        try {
          const result = await modelCall({
            imageBuffer: req.file.buffer,
            mimeType: req.file.mimetype,
          });
          // Log request metadata only — never the image bytes or the
          // recognised content itself. This proxy is inference-only and
          // keeps no record of what it read.
          console.log(JSON.stringify({ route: path, status: 200, ms: Date.now() - startedAt }));
          return res.json(result);
        } catch (err) {
          const ms = Date.now() - startedAt;
          if (err instanceof ProviderTimeoutError) {
            console.log(JSON.stringify({ route: path, status: 504, ms }));
            return res.status(504).json({ error: 'PROVIDER_TIMEOUT' });
          }
          if (err instanceof ProviderError) {
            console.error(
              JSON.stringify({
                route: path,
                status: 502,
                ms,
                providerError: String(err.message).slice(0, 500),
              }),
            );
            return res.status(502).json({ error: 'PROVIDER_ERROR' });
          }
          console.error(JSON.stringify({ route: path, status: 500, ms }));
          return res.status(500).json({ error: 'PROVIDER_ERROR' });
        }
      });
    });
  }

  // Shared handling for text-only routes (change 012's /parse-food-text,
  // extracted unchanged for change 020): JSON body, length limit, token,
  // rate limit and error mapping. Metadata-only logging.
  function registerTextRoute(path, modelCall, { maxChars, bodyLimit }) {
    app.post(path, checkSharedToken, express.json({ limit: bodyLimit }), async (req, res) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text || text.length > maxChars) {
        return res.status(400).json({ error: 'INVALID_TEXT' });
      }

      const reservation = rateLimiter.checkAndReserve();
      if (!reservation.allowed) {
        return res.status(429).json({ error: 'LIMIT_EXCEEDED' });
      }

      const startedAt = Date.now();
      try {
        const { result, usage } = await modelCall({ text });
        const ms = Date.now() - startedAt;
        // Metadata only: never the text or the parsed result.
        console.log(JSON.stringify({ route: path, status: 200, ms, ...usage }));
        if (usage.inputTokens != null) res.set('X-Usage-Input-Tokens', String(usage.inputTokens));
        if (usage.outputTokens != null) res.set('X-Usage-Output-Tokens', String(usage.outputTokens));
        return res.json(result);
      } catch (err) {
        const ms = Date.now() - startedAt;
        if (err instanceof ProviderTimeoutError) {
          console.log(JSON.stringify({ route: path, status: 504, ms }));
          return res.status(504).json({ error: 'PROVIDER_TIMEOUT' });
        }
        const status = err instanceof ProviderError ? 502 : 500;
        console.error(
          JSON.stringify({
            route: path,
            status,
            ms,
            providerError: String(err.message).slice(0, 500),
          }),
        );
        return res.status(status).json({ error: 'PROVIDER_ERROR' });
      }
    });
  }

  registerVisionRoute('/extract-label', models.extractLabel);
  // change 011-food-photo-input, task 2.1.
  registerVisionRoute('/recognize-food-components', models.recognizeFoodComponents);
  // change 020-paste-nutrition-text: screens, articles and package labels.
  registerVisionRoute('/read-nutrition-image', models.readNutritionImage);

  // change 012-voice-food-input: transcript text only, never audio.
  registerTextRoute('/parse-food-text', models.parseFoodText, {
    maxChars: config.maxParseTextChars,
    bodyLimit: '4kb',
  });
  // change 020-paste-nutrition-text: pasted/OCR text only, never images.
  registerTextRoute('/parse-nutrition-text', models.parseNutritionText, {
    maxChars: config.maxNutritionTextChars,
    bodyLimit: '32kb',
  });

  return app;
}

module.exports = { createApp };
