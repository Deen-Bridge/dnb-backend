import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";

export class HorizonClient {
  constructor(urls, timeoutMs = 10000) {
    this.timeoutMs = timeoutMs;
    this.endpoints = urls.map(url => ({
      url,
      server: new StellarSdk.Horizon.Server(url),
      state: 'closed', // 'closed' | 'open' | 'half-open'
      consecutiveFailures: 0,
      openedAt: null
    }));
    this.maxRetries = parseInt(process.env.HORIZON_MAX_RETRIES || "3", 10);
    this.cbThreshold = parseInt(process.env.HORIZON_CB_THRESHOLD || "5", 10);
    this.cbCooldownMs = parseInt(process.env.HORIZON_CB_COOLDOWN_MS || "30000", 10);
  }

  /**
   * Determine if an error is retriable and calculate its delay.
   * @param {Error} error
   * @param {number} attempt
   * @returns {{ retriable: boolean, delayMs?: number }}
   */
  classifyError(error, attempt) {
    if (error.name === "TimeoutError") {
      return { retriable: true, delayMs: this.calculateBackoff(attempt) };
    }

    const status = error.response?.status;
    
    // Deterministic Horizon rejections
    if (status === 404 || status === 400) {
      // 400 usually contains result_codes which must not be retried
      if (error.response?.data?.extras?.result_codes) {
        return { retriable: false };
      }
      if (status === 404) {
        return { retriable: false };
      }
    }

    // Rate Limiting
    if (status === 429) {
      const retryAfterStr = error.response?.headers?.['retry-after'];
      if (retryAfterStr) {
        const retryAfterSeconds = parseInt(retryAfterStr, 10);
        if (!isNaN(retryAfterSeconds)) {
          return { retriable: true, delayMs: retryAfterSeconds * 1000 };
        }
      }
      return { retriable: true, delayMs: this.calculateBackoff(attempt) };
    }

    // Network errors or 5xx server errors
    if (!status || status >= 500) {
      return { retriable: true, delayMs: this.calculateBackoff(attempt) };
    }

    return { retriable: false };
  }

  /**
   * Exponential backoff with full jitter.
   */
  calculateBackoff(attempt) {
    const base = 500;
    const max = 10000;
    const exp = Math.min(max, base * Math.pow(2, attempt));
    return Math.floor(Math.random() * exp);
  }

  /**
   * Get the current primary endpoint and advance to the next if requested.
   */
  getNextEndpoint(startIndex = 0) {
    const now = Date.now();
    for (let i = 0; i < this.endpoints.length; i++) {
      const index = (startIndex + i) % this.endpoints.length;
      const ep = this.endpoints[index];

      if (ep.state === 'open') {
        if (now - ep.openedAt >= this.cbCooldownMs) {
          ep.state = 'half-open';
          return { endpoint: ep, nextIndex: (index + 1) % this.endpoints.length };
        }
      } else {
        return { endpoint: ep, nextIndex: (index + 1) % this.endpoints.length };
      }
    }
    return { endpoint: null, nextIndex: 0 };
  }

  recordFailure(endpoint) {
    endpoint.consecutiveFailures++;
    if (endpoint.state === 'half-open' || endpoint.consecutiveFailures >= this.cbThreshold) {
      endpoint.state = 'open';
      endpoint.openedAt = Date.now();
      logger.warn(`Circuit breaker opened for Horizon endpoint ${endpoint.url}`);
    }
  }

  recordSuccess(endpoint) {
    if (endpoint.state === 'half-open') {
      logger.info(`Circuit breaker closed for Horizon endpoint ${endpoint.url} (recovery)`);
    }
    endpoint.state = 'closed';
    endpoint.consecutiveFailures = 0;
    endpoint.openedAt = null;
  }

  /**
   * Execute a Horizon call against the current primary endpoint.
   * @param {Function} fn - The function to execute, receives (server).
   * @param {Object} opts - Options for execution. { mode: 'read' | 'submit' }
   */
  async execute(fn, opts = { mode: 'read' }) {
    let attempt = 0;
    let endpointIndex = 0;
    
    while (attempt <= this.maxRetries) {
      const { endpoint, nextIndex } = this.getNextEndpoint(endpointIndex);
      
      if (!endpoint) {
        const err = new Error("All endpoints open");
        err.name = "AllEndpointsOpenError";
        throw err;
      }
      
      endpointIndex = nextIndex;

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, this.timeoutMs);

      try {
        const callPromise = fn(endpoint.server);
        
        const timeoutPromise = new Promise((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            const err = new Error("Horizon request timed out");
            err.name = "TimeoutError";
            reject(err);
          });
        });

        const result = await Promise.race([callPromise, timeoutPromise]);
        clearTimeout(timeoutId);
        
        this.recordSuccess(endpoint);
        
        return result;
      } catch (error) {
        clearTimeout(timeoutId);

        if (opts.mode === 'submit') {
          if (error.name === 'TimeoutError' && opts.verifyFn && attempt === 0) {
            const landedResult = await opts.verifyFn();
            if (landedResult && landedResult.successful) {
              return landedResult;
            }
            attempt++;
            continue; // resubmit at most once
          }
          throw error; // bypass generic blind retry entirely
        }

        const classification = this.classifyError(error, attempt);
        
        if (classification.retriable) {
          this.recordFailure(endpoint);
        }

        if (!classification.retriable || attempt === this.maxRetries) {
          throw error;
        }

        // Wait for the computed delay before retrying
        await new Promise(resolve => setTimeout(resolve, classification.delayMs));
        attempt++;
      }
    }
  }
}

// Export a pre-configured instance of HorizonClient
export const client = new HorizonClient(
  (process.env.HORIZON_URLS || "https://horizon-testnet.stellar.org").split(",").map(u => u.trim()),
  parseInt(process.env.HORIZON_TIMEOUT_MS || "10000", 10)
);

export const getHorizonHealth = () => {
  return client.endpoints.map(ep => ({
    url: ep.url,
    state: ep.state,
    consecutiveFailures: ep.consecutiveFailures,
    openedAt: ep.openedAt
  }));
};
