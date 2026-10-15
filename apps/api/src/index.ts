import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { loadConfig } from "./env.js";
import { startupSummary } from "./startup-log.js";

// Local development reads the repo-root .env. Variables already set (as hosts do) take precedence.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment.
}

const config = loadConfig();
const app = createApp(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(JSON.stringify({ level: "info", msg: "svalin_api_started", port: info.port, ...startupSummary(config) }));
});
