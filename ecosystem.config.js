/**
 * PM2 Ecosystem Configuration
 * ----------------------------
 * Process management for the DeenBridge backend in production.
 *
 * Start:
 *   pm2 start ecosystem.config.js --env production
 *
 * Reload all cluster instances with zero downtime:
 *   pm2 reload ecosystem.config.js --update-env
 *
 * Cluster mode spreads the app across all CPU cores (instances: "max"),
 * with auto-restart on crash and restart when memory exceeds a threshold.
 *
 * Log ROTATION is handled by the pm2-logrotate module. It is NOT bundled
 * with pm2 itself, so after first install run:
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 50M          # rotate files > 50MB
 *   pm2 set pm2-logrotate:retain 10             # keep 10 rotated files
 *   pm2 set pm2-logrotate:compress true         # gzip rotated logs
 *   pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # daily rotation
 */

export default {
  apps: [
    {
      name: "dnb-backend",

      // Entry point (ESM — the repo's package.json declares "type": "module").
      script: "./server.js",
      cwd: "./",

      // ── Cluster mode for multi-core usage ────────────────────────────────
      // instances "max" (or -1) spawns one worker per available CPU core.
      exec_mode: "cluster",
      instances: "max",

      // ── Resiliency: auto-restart + max-memory-restart ───────────────────
      // autorestart: restart on crash (or peaceful exit) by default.
      autorestart: true,
      // Watch disabled in production — deploys should trigger restarts.
      watch: false,
      // Kill process if it exceeds memory, then restart it.
      max_memory_restart: "1G",
      // Grace period before considering a process stable.
      min_uptime: "10s",
      // Wait before restarting a crashed app.
      restart_delay: 4000,
      // Give app up to 30s to listen before forcing a reload.
      listen_timeout: 30000,
      kill_timeout: 10000,
      // Consecutive unstable restarts before PM2 gives up (default 16).
      max_restarts: 16,

      // ── Environment ──────────────────────────────────────────────────────
      env: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: "production",
      },

      // ── Logging & rotation ───────────────────────────────────────────────
      // Rotated/aggregated log locations (see pm2-logrotate module notes
      // above for auto-rotation / compression / retention).
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      // Avoid per-PID log suffixes so all cluster workers share one log file.
      merge_logs: true,
      // Prefix every log line with a timestamp.
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,
    },
  ],
};