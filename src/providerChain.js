// Ordered provider fallback (e.g. gemini -> glm -> error) for one model task,
// used by both text and image routes. Every provider failure falls through to
// the next; when all fail the last error is rethrown, so app.js keeps its
// 502/504 mapping and the mobile contract is unchanged. The whole chain fits
// inside `deadlineMs`, which sits below the mobile client's own timeout.

function failureReason(err, ProviderTimeoutError) {
  if (err instanceof ProviderTimeoutError) return 'timeout';
  const status = err?.status;
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_5xx';
  if (status >= 400) return 'config_error';
  return 'provider_error';
}

function withTimeout(promise, ms, ProviderTimeoutError) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError('Provider attempt timed out')), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// Shared across chains: a provider that answered 429 (quota/overload) is
// skipped for `cooldownMs`, so later requests go straight to the next one.
function createCooldowns({ cooldownMs, now = Date.now }) {
  const until = new Map();
  return {
    isCooling: (provider) => (until.get(provider) ?? 0) > now(),
    trip: (provider) => until.set(provider, now() + cooldownMs),
  };
}

function createChain({
  task,
  attempts, // [{ provider, call }] in order
  deadlineMs, // budget for the whole chain
  firstAttemptMs, // cap for every attempt except the last
  providerTimeoutMs,
  cooldowns,
  ProviderTimeoutError,
  now = Date.now,
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  if (!attempts.length) throw new Error(`No providers configured for ${task}`);

  return async function runChain(args) {
    const startedAt = now();
    const fallbacks = [];
    let lastError;

    // Cooling providers are skipped, but never all of them: if every one is
    // cooling, the last provider is still tried rather than failing blind.
    const active = attempts.filter((a) => !cooldowns.isCooling(a.provider));
    const plan = active.length ? active : attempts.slice(-1);
    for (const skipped of attempts.filter((a) => !plan.includes(a))) {
      fallbacks.push({ provider: skipped.provider, reason: 'cooldown' });
    }

    for (let i = 0; i < plan.length; i += 1) {
      const { provider, call } = plan[i];
      const remaining = deadlineMs - (now() - startedAt);
      if (remaining <= 0) {
        lastError = new ProviderTimeoutError(`${task}: chain deadline exceeded`);
        break;
      }
      const isLast = i === plan.length - 1;
      const timeoutMs = Math.min(providerTimeoutMs, remaining, isLast ? Infinity : firstAttemptMs);

      try {
        const out = await withTimeout(call({ ...args, timeoutMs }), timeoutMs, ProviderTimeoutError);
        if (fallbacks.length) log({ task, provider, fallbacks });
        // Text routes return { result, usage }; tag which provider answered.
        if (out && typeof out === 'object' && out.usage && typeof out.usage === 'object') {
          return { ...out, usage: { ...out.usage, provider } };
        }
        return out;
      } catch (err) {
        lastError = err;
        const reason = failureReason(err, ProviderTimeoutError);
        if (reason === 'rate_limited') cooldowns.trip(provider);
        fallbacks.push({ provider, reason });
      }
    }

    log({ task, provider: null, fallbacks });
    throw lastError;
  };
}

module.exports = { createChain, createCooldowns, failureReason };
