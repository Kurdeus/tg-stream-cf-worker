#!/usr/bin/env node
// One-command installer:  npm run setup
// Creates KV namespaces, deploys the Worker, sets secrets and registers the Telegram webhook.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import readline from "node:readline/promises";

const isWin = process.platform === "win32";
const WORKER = "tg-stream-worker";
const log = (m) => console.log("\n\x1b[36m>> " + m + "\x1b[0m");
const die = (m) => { console.error("\n\x1b[31mERROR: " + m + "\x1b[0m"); process.exit(1); };

function wr(args, { input, inherit = false } = {}) {
  const r = spawnSync("npx", ["--yes", "wrangler", ...args], {
    encoding: "utf8", input, shell: isWin,
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

if (!existsSync("node_modules")) { log("Installing dependencies..."); execSync("npm install", { stdio: "inherit" }); }

// 1. Login ---------------------------------------------------------------
log("Checking Cloudflare login...");
if (!/You are logged in/i.test(wr(["whoami"]).out)) {
  console.log("A browser window will open - log in to Cloudflare and click Allow.");
  if (wr(["login"], { inherit: true }).code !== 0) die("Cloudflare login failed.");
}

// 2. Questions -----------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (name, hint) => {
  const preset = process.env[name];
  if (preset) return preset.trim();
  return (await rl.question(`${name} (${hint}): `)).trim();
};
const API_ID = await ask("API_ID", "number from https://my.telegram.org");
const API_HASH = await ask("API_HASH", "string from https://my.telegram.org");
const BOT_TOKEN = await ask("BOT_TOKEN", "from @BotFather");
const BIN_CHANNEL = await ask("BIN_CHANNEL", "private channel id like -100123456789, bot must be ADMIN there");
rl.close();
if (!API_ID || !API_HASH || !BOT_TOKEN || !BIN_CHANNEL) die("All four values are required.");
if (!/^-100\d+$/.test(BIN_CHANNEL)) die("BIN_CHANNEL must look like -100123456789 (note the -100 prefix).");

log("Validating bot token with Telegram...");
const me = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)).json();
if (!me.ok) die("Telegram rejected BOT_TOKEN: " + me.description);
console.log("Bot: @" + me.result.username);

const member = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: BIN_CHANNEL, user_id: me.result.id }),
})).json();
if (!member.ok) die(`The bot cannot see BIN_CHANNEL (${member.description}). Add the bot to the channel as ADMIN, then run again.`);
if (!["administrator", "creator"].includes(member.result.status)) die(`The bot is "${member.result.status}" in the channel - it must be an ADMIN.`);
console.log("Channel access OK.");

// 3. KV namespaces -------------------------------------------------------
log("Preparing KV namespaces...");
let existing = [];
try { existing = JSON.parse(wr(["kv", "namespace", "list"]).out.match(/\[[\s\S]*\]/)[0]); } catch { }
async function kv(binding) {
  const title = `${WORKER}-${binding}`;
  const found = existing.find((n) => n.title === title);
  if (found) return found.id;
  const r = wr(["kv", "namespace", "create", title]);
  const id = r.out.match(/\b([0-9a-f]{32})\b/i)?.[1];
  if (!id) die("Could not create KV namespace " + title + "\n" + r.out);
  return id;
}
const sessionsId = await kv("SESSIONS");
let toml = readFileSync("wrangler.toml", "utf8");
for (const [binding, id] of [["SESSIONS", sessionsId]]) {
  const re = new RegExp(`(binding = "${binding}"[ \\t]*\\n)(id = "[^"]*"[ \\t]*\\n)?`);
  toml = toml.replace(re, `$1id = "${id}"\n`);
}
writeFileSync("wrangler.toml", toml);

// 4. Deploy --------------------------------------------------------------
log("Deploying Worker...");
const dep = wr(["deploy"]);
console.log(dep.out);
if (dep.code !== 0) die("Deploy failed (see output above).");
const workerUrl = dep.out.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
if (!workerUrl) die("Deployed, but could not detect the worker URL. Open /setup on it manually.");

// 5. Secrets -------------------------------------------------------------
log("Uploading secrets...");
for (const [k, v] of Object.entries({ API_ID, API_HASH, BOT_TOKEN, BIN_CHANNEL })) {
  const r = wr(["secret", "put", k], { input: v + "\n" });
  if (r.code !== 0) die(`Failed to set secret ${k}\n${r.out}`);
  console.log("  set " + k);
}

// 6. Register webhook & verify ------------------------------------------
log("Registering Telegram webhook...");
await new Promise((r) => setTimeout(r, 4000)); // let the new version propagate
let status;
for (let i = 0; i < 5; i++) {
  try { status = await (await fetch(workerUrl + "/setup")).json(); if (status.ok) break; } catch { }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(JSON.stringify(status, null, 2));
if (status?.ok) console.log(`\n\x1b[32mDONE. Open Telegram, message @${me.result.username} and press /start.\x1b[0m\nWorker: ${workerUrl}`);
else console.log(`\n\x1b[33mDeployed, but not fully healthy yet. Open ${workerUrl}/setup in a browser and read the message.\x1b[0m`);
