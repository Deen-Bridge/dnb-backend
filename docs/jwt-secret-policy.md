# JWT secret policy

Production boot fails when JWT_SECRET is missing, shorter than 32 characters,
or equal to a known placeholder. The validation logs only the policy failure;
it never prints the secret.

Test and development use explicit local-only defaults so tests remain
reproducible. Authentication middleware also has no production fallback:
without a validated production secret, verification cannot succeed. Deploy
configuration should provide a randomly generated secret through the runtime
secret manager and include the redacted validation result in release evidence.
