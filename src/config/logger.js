import pino from "pino";

const isDev = process.env.NODE_ENV === "development";
const logLevel = process.env.LOG_LEVEL || (isDev ? "debug" : "info");

const transport = isDev
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-MM-dd HH:mm:ss.l",
        ignore: "pid,hostname",
      },
    }
  : undefined;

const logger = pino({
  level: logLevel,
  transport,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "newPassword",
      "otp",
      "token",
      "signedXdr",
      "JWT_SECRET",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

logger.stream = {
  write: (message) => logger.info(message.trim()),
};

export default logger;
