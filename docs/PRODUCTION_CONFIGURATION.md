# Production configuration

`validateEnv` fails startup when production secrets are missing, placeholder-like, or weak; when CORS contains a wildcard or invalid origin; when provider URLs contain credentials or use the wrong protocol; or when cookie, email, Cloudinary, webhook, and Stellar settings are inconsistent.

The boot log includes only the environment, Stellar network, and a short SHA-256 configuration fingerprint. It never prints secret values. `CORS_ALLOWED_ORIGINS` accepts a comma-separated list of explicit HTTPS origins. Keep a rotation owner, last-rotated date, rollback value, and emergency-disable procedure in the deployment secret manager; rotate by deploying the replacement first, verifying health, then revoking the old value.
