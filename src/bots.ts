import type { Env } from "./env";
import { guardCall } from "./guard";

/**
 * Helper bots are extra bot accounts used ONLY to read files from the storage channel when the
 * main bot is rate limited (FLOOD_WAIT) or fails. They never talk to users.
 * Each helper bot must be an admin of BIN_CHANNEL.
 */
export interface HelperBot { id: number; username: string; token: string }

export interface Candidate {
    key: string;      // bot id, used for cooldown bookkeeping and as a cache key
    token: string;
    label: string;    // "@username" or "main bot": safe to log, never contains the token
    primary: boolean;
}

export type Mode = "fallback" | "spread";

const HELPERS_KEY = "bots:helpers";
const MODE_KEY = "bots:mode";

export const botKey = (token: string) => token.split(":")[0];
export const sessionKey = (token: string) => "session:gramjs:" + token;

export async function getHelpers(env: Env): Promise<HelperBot[]> {
    try {
        const raw = await env.SESSIONS.get(HELPERS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list)
            ? list.filter((b: any) => b && typeof b.token === "string" && Number.isFinite(b.id))
            : [];
    } catch {
        return [];
    }
}

export async function saveHelpers(env: Env, list: HelperBot[]): Promise<void> {
    await env.SESSIONS.put(HELPERS_KEY, JSON.stringify(list));
}

export async function getMode(env: Env): Promise<Mode> {
    return (await env.SESSIONS.get(MODE_KEY)) === "spread" ? "spread" : "fallback";
}

export async function setMode(env: Env, mode: Mode): Promise<void> {
    await env.SESSIONS.put(MODE_KEY, mode);
}

/**
 * Map of bot id -> epoch ms until which the bot should be avoided. Expired entries are dropped.
 * The map lives in the guard Durable Object, which applies every change one at a time.
 */
export async function getCooldowns(env: Env, now = Date.now()): Promise<Record<string, number>> {
    const r = await guardCall(env, "cooldown.get");
    const out: Record<string, number> = {};
    if (r?.map && typeof r.map === "object") for (const [k, v] of Object.entries(r.map)) if (typeof v === "number" && v > now) out[k] = v;
    return out;
}

export async function setCooldown(env: Env, key: string, untilMs: number): Promise<void> {
    await guardCall(env, "cooldown.set", { key, until: untilMs });
}

export async function clearCooldown(env: Env, key: string): Promise<void> {
    await guardCall(env, "cooldown.clear", { key });
}

/**
 * Order in which bots are tried for one download:
 *  - bots that are not cooling down come first, the rest follow, soonest-to-recover first
 *  - "fallback" mode keeps the main bot first; "spread" rotates the ready bots randomly so
 *    parallel connections use different accounts
 */
export function orderCandidates(
    all: Candidate[],
    cooldowns: Record<string, number>,
    mode: Mode,
    rand: () => number = Math.random,
): Candidate[] {
    const ready = all.filter(c => !(c.key in cooldowns));
    const cooling = all.filter(c => c.key in cooldowns).sort((a, b) => cooldowns[a.key] - cooldowns[b.key]);
    if (mode === "spread" && ready.length > 1) {
        const k = Math.floor(rand() * ready.length) % ready.length;
        return [...ready.slice(k), ...ready.slice(0, k), ...cooling];
    }
    return [...ready, ...cooling];
}

export async function getCandidates(env: Env): Promise<Candidate[]> {
    const [helpers, cooldowns, mode] = await Promise.all([getHelpers(env), getCooldowns(env), getMode(env)]);
    const all: Candidate[] = [
        { key: botKey(env.BOT_TOKEN), token: env.BOT_TOKEN, label: "main bot", primary: true },
        ...helpers.map(h => ({ key: String(h.id), token: h.token, label: `@${h.username}`, primary: false })),
    ];
    return orderCandidates(all, cooldowns, mode);
}

// ---------------------------------------------------------------------------------------------
export type Failure =
    | { kind: "flood"; seconds: number }   // Telegram says: slow down for N seconds
    | { kind: "session" }                  // the saved login is dead: log in again with the token
    | { kind: "access" }                   // token revoked, or the bot lost access to the channel
    | { kind: "fatal" }                    // our own configuration is wrong: no other bot can help
    | { kind: "other" };                   // timeouts, dropped sockets and so on

export function classifyError(e: any): Failure {
    const text = `${e?.errorMessage ?? ""} ${e?.message ?? e ?? ""}`;

    // Our own check, or Telegram rejecting the api_id / api_hash: no other bot can fix that.
    if (/API_ID is invalid|API_ID_INVALID|API_ID_PUBLISHED_FLOOD|API_HASH_INVALID/i.test(text)) return { kind: "fatal" };

    const flood = /FLOOD_WAIT_(\d+)/i.exec(text) || /wait of (\d+) seconds/i.exec(text);
    if (flood) return { kind: "flood", seconds: Number(flood[1]) };
    if (e?.errorMessage === "FLOOD" && Number.isFinite(e?.seconds)) return { kind: "flood", seconds: Number(e.seconds) };

    if (/AUTH_KEY_(UNREGISTERED|DUPLICATED|INVALID)|SESSION_(REVOKED|EXPIRED)|USER_DEACTIVATED/i.test(text)) return { kind: "session" };
    if (/ACCESS_TOKEN_(INVALID|EXPIRED)|CHANNEL_(INVALID|PRIVATE)|CHAT_(ADMIN_REQUIRED|FORBIDDEN|WRITE_FORBIDDEN)|BOT_METHOD_INVALID|Bot cannot access BIN_CHANNEL/i.test(text)) return { kind: "access" };

    return { kind: "other" };
}

/** How long to avoid a bot after a failure (milliseconds), 0 = do not avoid. */
export function cooldownFor(f: Failure): number {
    switch (f.kind) {
        case "flood": return Math.min(Math.max(f.seconds, 1), 3600) * 1000 + 2000;
        case "access": return 10 * 60 * 1000;
        case "session": return 30 * 1000;
        default: return 0;
    }
}
