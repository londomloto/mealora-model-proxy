const express = require('express');
const cors = require('cors');
const multer = require('multer');

const config = require('./config');
const rateLimiter = require('./rateLimiter');
const {
  extractLabel,
  recognizeFoodComponents,
  ProviderTimeoutError,
  ProviderError,
} = require('./geminiClient');

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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', usage: rateLimiter.currentUsage() });
});

// Shared request handling for both inference routes: multipart image
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

registerVisionRoute('/extract-label', extractLabel);
// change 011-food-photo-input, task 2.1.
registerVisionRoute('/recognize-food-components', recognizeFoodComponents);

app.listen(config.port, () => {
  console.log(`mealora-model-proxy listening on :${config.port}`);
});
