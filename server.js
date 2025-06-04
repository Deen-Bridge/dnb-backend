import { server } from "./app.js";
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀🕌 DeenBridge API running on port ${PORT}`)
);
