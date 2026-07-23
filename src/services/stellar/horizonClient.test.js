// src/services/stellar/horizonClient.test.js
import { jest } from "@jest/globals";
import { HorizonClient } from "./horizonClient.js";

describe("HorizonClient - Phase 2", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("should enforce HORIZON_TIMEOUT_MS and reject with timeout error", async () => {
    const originalRetries = process.env.HORIZON_MAX_RETRIES;
    process.env.HORIZON_MAX_RETRIES = "0";
    const client = new HorizonClient(["https://fake-url"], 5000);
    
    const hangingCall = async () => new Promise(() => {}); // never resolves

    const executePromise = client.execute(hangingCall);
    
    jest.advanceTimersByTime(5001);

    await expect(executePromise).rejects.toThrow("Horizon request timed out");
    if (originalRetries === undefined) {
      delete process.env.HORIZON_MAX_RETRIES;
    } else {
      process.env.HORIZON_MAX_RETRIES = originalRetries;
    }
  });

  it("should succeed if call completes before timeout", async () => {
    const client = new HorizonClient(["https://fake-url"], 5000);
    
    const executePromise = client.execute(async () => "success");
    
    const result = await executePromise;
    expect(result).toBe("success");
  });
});

describe("HorizonClient - Phase 3 (Classification & Backoff)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(global.Math, 'random').mockReturnValue(0.99); // max jitter
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const client = new HorizonClient(["https://url1", "https://url2"], 5000);

  it.each([
    ["Network Error", { name: "Error" }, true],
    ["Timeout Error", { name: "TimeoutError" }, true],
    ["500 Server Error", { response: { status: 500 } }, true],
    ["503 Server Error", { response: { status: 503 } }, true],
    ["429 Rate Limit", { response: { status: 429 } }, true],
    ["404 Not Found", { response: { status: 404 } }, false],
    ["400 tx_bad_seq", { response: { status: 400, data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } }, false],
    ["400 op_underfunded", { response: { status: 400, data: { extras: { result_codes: { operations: ["op_underfunded"] } } } } }, false],
  ])("should classify %s correctly", (_, errorObj, expectedRetriable) => {
    const classification = client.classifyError(errorObj, 0);
    expect(classification.retriable).toBe(expectedRetriable);
  });

  it("should honor Retry-After header for 429", async () => {
    const c = new HorizonClient(["https://url1"], 5000);
    let attempts = 0;
    
    const executePromise = c.execute(async () => {
      attempts++;
      if (attempts === 1) {
        const err = new Error("Rate limit");
        err.response = { status: 429, headers: { 'retry-after': '2' } };
        throw err;
      }
      return "success";
    });

    // Let the first call throw and setTimeout to be scheduled
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(1999);
    expect(attempts).toBe(1);

    jest.advanceTimersByTime(2);
    const result = await executePromise;
    expect(result).toBe("success");
    expect(attempts).toBe(2);
  });

  it("should use exponential backoff if no Retry-After is present", async () => {
    const c = new HorizonClient(["https://url1"], 5000);
    let attempts = 0;
    
    const executePromise = c.execute(async () => {
      attempts++;
      if (attempts < 3) throw new Error("Network error");
      return "success";
    });

    // Wait for the first attempt to fail and backoff timer to start
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(1);

    // Attempt 1 backoff (base 500, attempt 0 -> 500 * 0.99 = 495)
    jest.advanceTimersByTime(494);
    expect(attempts).toBe(1);

    jest.advanceTimersByTime(2); // reaches 496, unblocks attempt 2
    
    // Allow promise chain to queue the next backoff
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(2);

    // Attempt 2 backoff (base 500, attempt 1 -> 1000 * 0.99 = 990)
    jest.advanceTimersByTime(989);
    expect(attempts).toBe(2);

    jest.advanceTimersByTime(2); // reaches 991, unblocks attempt 3
    
    const result = await executePromise;
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });
});

describe("HorizonClient - Phase 4 (Circuit Breaker)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("should open circuit after HORIZON_CB_THRESHOLD failures, allow half-open, and close on success", async () => {
    const c = new HorizonClient(["https://url1"], 5000);
    c.maxRetries = 0; // disable retry so we can directly trigger failures
    c.cbThreshold = 2;
    c.cbCooldownMs = 30000;

    const failCall = async () => { throw new Error("Network error"); };
    const successCall = async () => "success";

    // Failure 1
    await expect(c.execute(failCall)).rejects.toThrow("Network error");
    expect(c.endpoints[0].state).toBe("closed");
    expect(c.endpoints[0].consecutiveFailures).toBe(1);

    // Failure 2 -> Opens circuit
    await expect(c.execute(failCall)).rejects.toThrow("Network error");
    expect(c.endpoints[0].state).toBe("open");
    expect(c.endpoints[0].consecutiveFailures).toBe(2);

    // Call while open -> All endpoints open
    await expect(c.execute(successCall)).rejects.toThrow("All endpoints open");

    // Advance time past cooldown
    jest.advanceTimersByTime(30000);

    // Half-open success -> Closes circuit
    const result = await c.execute(successCall);
    expect(result).toBe("success");
    expect(c.endpoints[0].state).toBe("closed");
    expect(c.endpoints[0].consecutiveFailures).toBe(0);
  });

  it("should return to open state if half-open probe fails", async () => {
    const c = new HorizonClient(["https://url1"], 5000);
    c.maxRetries = 0;
    c.cbThreshold = 1;
    c.cbCooldownMs = 30000;

    const failCall = async () => { throw new Error("Network error"); };

    // Failure 1 -> Opens circuit
    await expect(c.execute(failCall)).rejects.toThrow("Network error");
    expect(c.endpoints[0].state).toBe("open");

    // Advance time past cooldown
    jest.advanceTimersByTime(30000);

    // Half-open failure -> Opens circuit again
    await expect(c.execute(failCall)).rejects.toThrow("Network error");
    expect(c.endpoints[0].state).toBe("open");
    expect(c.endpoints[0].consecutiveFailures).toBe(2);
  });

  it("should fail fast if all endpoints are open", async () => {
    const c = new HorizonClient(["https://url1", "https://url2"], 5000);
    c.maxRetries = 0;
    c.cbThreshold = 1;

    const failCall = async () => { throw new Error("Network error"); };

    // Fail endpoint 1
    await expect(c.execute(failCall)).rejects.toThrow("Network error");
    // Fail endpoint 2
    await expect(c.execute(failCall)).rejects.toThrow("Network error");

    // Both open, should fail fast
    try {
      await c.execute(async () => "success");
      fail("Should have thrown");
    } catch (error) {
      expect(error.message).toBe("All endpoints open");
      expect(error.name).toBe("AllEndpointsOpenError");
    }
  });
});

describe("HorizonClient - Phase 5 (Submission Safety)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("should not double submit if transaction landed during timeout", async () => {
    const c = new HorizonClient(["https://url1"], 5000);
    
    let submitCount = 0;
    const submitCall = async () => {
      submitCount++;
      return new Promise(() => {}); // timeout
    };

    const verifyFn = async () => {
      return { successful: true, ledger: 100 };
    };

    const executePromise = c.execute(submitCall, { mode: 'submit', verifyFn });
    
    await jest.advanceTimersByTimeAsync(5001);
    
    const result = await executePromise;
    expect(result.successful).toBe(true);
    expect(result.ledger).toBe(100);
    expect(submitCount).toBe(1);
  });

  it("should single resubmit if transaction did not land during timeout", async () => {
    const c = new HorizonClient(["https://url1"], 5000);
    
    let submitCount = 0;
    const submitCall = async () => {
      submitCount++;
      if (submitCount === 1) return new Promise(() => {}); // timeout
      return { successful: true, ledger: 101 };
    };

    const verifyFn = async () => {
      return null; // not found
    };

    const executePromise = c.execute(submitCall, { mode: 'submit', verifyFn });
    
    await jest.advanceTimersByTimeAsync(5001);
    
    const result = await executePromise;
    expect(result.successful).toBe(true);
    expect(result.ledger).toBe(101);
    expect(submitCount).toBe(2);
  });

  it("should not retry on immediate result_codes rejection", async () => {
    const c = new HorizonClient(["https://url1"], 5000);
    
    let submitCount = 0;
    const submitCall = async () => {
      submitCount++;
      const err = new Error("Bad Request");
      err.response = { status: 400, data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } };
      throw err;
    };

    const verifyFn = async () => null;

    const executePromise = c.execute(submitCall, { mode: 'submit', verifyFn });
    
    await expect(executePromise).rejects.toThrow("Bad Request");
    expect(submitCount).toBe(1);
  });
});



