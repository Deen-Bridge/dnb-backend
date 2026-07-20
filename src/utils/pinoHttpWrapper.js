import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pinoHttpModule = require("pino-http");
export const pinoHttp = pinoHttpModule.pinoHttp || pinoHttpModule.default || pinoHttpModule;
export const stdSerializers = pinoHttpModule.stdSerializers;
export const startTime = pinoHttpModule.startTime;
