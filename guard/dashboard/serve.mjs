// Serves the dashboard on this machine only: node dashboard/serve.mjs, then open
// http://127.0.0.1:8410/?vault=vault5.svalin-demo.testnet. Plain Node, no packages.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8410);
const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/theme.js": ["theme.js", "text/javascript; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/guard.wasm": ["../target/near/svalin_guard/svalin_guard.wasm", "application/wasm"],
  "/testnet.json": ["testnet.json", "application/json"],
  "/vendor/near-connect-0.11.4.mjs": ["vendor/near-connect-0.11.4.mjs", "text/javascript; charset=utf-8"],
};

createServer(async (request, response) => {
  const file = FILES[new URL(request.url ?? "/", "http://localhost").pathname];
  if (request.method !== "GET" || !file) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const body = await readFile(new URL(file[0], import.meta.url));
  response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(body);
}).listen(PORT, "127.0.0.1", () => console.log(`Svalin Guard dashboard: http://127.0.0.1:${PORT}/`));
