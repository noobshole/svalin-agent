// Checks the live API, website and Svalin Index (see .github/workflows/monitor.yml). Any failed
// check fails the run, and GitHub emails the repository owner. No dependencies, no secrets.
const API = process.env.SVALIN_API ?? "https://svalin-api.noobshole.workers.dev";
const SITE = process.env.SVALIN_SITE ?? "https://svalin.noobshole.workers.dev";
// Every address a paid route may ask to be paid at. Changing one must be deliberate: a payee that
// is not on this list means someone may be redirecting payments.
const PAYEES = new Set((process.env.SVALIN_PAYEES ?? "").split(",").map((payee) => payee.trim()).filter(Boolean));
const MAX_INDEX_AGE_HOURS = 12;

const failures = [];

/** One HTTP request, retried once so a single network blip does not raise an alarm. */
async function get(url, init = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resume) => setTimeout(resume, 5_000));
    }
  }
}

async function check(name, run) {
  try {
    await run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await check("API answers", async () => {
  const response = await get(`${API}/health`);
  assert(response.status === 200, `health returned ${response.status}`);
});

await check("Payments go to our own accounts", async () => {
  assert(PAYEES.size > 0, "SVALIN_PAYEES is not set");
  const response = await get(`${API}/v1/risk/root.near`);
  assert(response.status === 402, `a paid route returned ${response.status}, not 402`);
  const header = response.headers.get("payment-required");
  assert(header, "no PAYMENT-REQUIRED header");
  const { accepts } = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  assert(Array.isArray(accepts) && accepts.length > 0, "the payment request offers no way to pay");
  const unknown = accepts.map((accept) => `${accept.network} ${accept.payTo}`).filter((entry) => !PAYEES.has(entry.split(" ")[1]));
  assert(unknown.length === 0, `unexpected payee: ${unknown.join(", ")}`);
});

await check("Only our website may read the API from a browser", async () => {
  const response = await get(`${API}/v1/index/near-tokens`, { method: "HEAD", headers: { origin: "https://example.com" } });
  assert(!response.headers.get("access-control-allow-origin"), "the API answered a foreign origin");
});

await check(`Svalin Index is fresh (under ${MAX_INDEX_AGE_HOURS} hours)`, async () => {
  const response = await get(`${API}/v1/index/near-tokens`);
  assert(response.status === 200, `index returned ${response.status}`);
  const index = await response.json();
  const hours = (Date.now() - Date.parse(index.generatedAt)) / 3_600_000;
  assert(hours < MAX_INDEX_AGE_HOURS, `the latest edition is ${hours.toFixed(1)} hours old`);
  assert(Array.isArray(index.rows) && index.rows.length > 1_000, `only ${index.rows?.length ?? 0} tokens in the edition`);
});

await check("Website answers with its security headers", async () => {
  const response = await get(`${SITE}/`);
  assert(response.status === 200, `home page returned ${response.status}`);
  const csp = response.headers.get("content-security-policy") ?? "";
  assert(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"), "Content-Security-Policy is missing or changed");
  // The site loads scripts only from itself. A script from anywhere else means it was tampered with.
  const html = await response.text();
  const sources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
  const foreign = sources.filter((source) => !source.startsWith("/_next/"));
  assert(foreign.length === 0, `scripts from outside the site: ${foreign.join(", ")}`);
});

await check("security.txt is published", async () => {
  const response = await get(`${SITE}/.well-known/security.txt`);
  assert(response.status === 200, `security.txt returned ${response.status}`);
});

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nEverything is as expected.");
