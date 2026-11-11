const config = require('./config');

// In-memory only: this proxy stores no user data and no persistent database,
// so the daily counters reset on process restart as well as at midnight.
// That's an accepted trade-off for a deliberately minimal, stateless proxy.
let windowStartDay = currentDayKey();
let requestCount = 0;
let estimatedCostUsd = 0;

function currentDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function rollWindowIfNeeded() {
  const today = currentDayKey();
  if (today !== windowStartDay) {
    windowStartDay = today;
    requestCount = 0;
    estimatedCostUsd = 0;
  }
}

function checkAndReserve() {
  rollWindowIfNeeded();
  const wouldExceedRequests = requestCount + 1 > config.maxRequestsPerDay;
  const wouldExceedCost =
    estimatedCostUsd + config.estimatedCostUsdPerRequest > config.maxEstimatedCostUsdPerDay;

  if (wouldExceedRequests || wouldExceedCost) {
    return { allowed: false };
  }

  requestCount += 1;
  estimatedCostUsd += config.estimatedCostUsdPerRequest;
  return { allowed: true };
}

function currentUsage() {
  rollWindowIfNeeded();
  return { requestCount, estimatedCostUsd, day: windowStartDay };
}

module.exports = { checkAndReserve, currentUsage };
