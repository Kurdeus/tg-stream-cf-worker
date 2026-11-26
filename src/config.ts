import type { Env } from "./env";

/**
 * Loads the settings (API_ID, API_HASH, BOT_TOKEN, BIN_CHANNEL, ADMIN_IDS, MIRROR_BOT_TOKEN_n)
 * from a ".dev.vars" style text file hosted at GIST_URL, so nothing has to be set by hand.
 *
 * Priority: a value in the gist wins over a value set in Cloudflare (a Cloudflare value is only
 * the fallback). The gist is cached in memory for CACHE_MS; if GitHub cannot be reached the last
 * good copy is used (memory first, then KV), so a GitHub hiccup never takes the bot down.
 */

const CACHE_MS = 60_000;
const KV_BACKUP_KEY = "config:gist:backup";

let cache: { url: string; vars: Record<string, string>; at: number } | null = null;

/** Parses ".dev.vars" / ".env" text: KEY=VALUE per line, "#" comments, optional quotes and "export ". */
export function parseVars(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!m) continue;
        let value = m[2].trim();
        if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
            value = value.slice(1, -1);
        } else {
            value = value.replace(/\s+#.*$/, ""); // trailing comment on an unquoted value
        }
        out[m[1]] = value;
    }
    return out;
}

/** MIRROR_BOT_TOKEN_1, MIRROR_BOT_TOKEN_2, ... -> ["token1", "token2", ...] in numeric order. */
export function mirrorTokens(vars: Record<string, string>): string[] {
    return Object.keys(vars)
        .map(k => ({ k, m: /^MIRROR_BOT_TOKEN_(\d+)$/.exec(k) }))
        .filter((x): x is { k: string; m: RegExpExecArray } => !!x.m && !!vars[x.k])
        .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
        .map(x => vars[x.k]);
}

async function fetchGist(env: Env, url: string): Promise<Record<string, string>> {
    try {
        const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const vars = parseVars(text);
        if (!Object.keys(vars).length) throw new Error("gist is empty or not in KEY=VALUE format");
        // Keep a backup copy only when it changed, so KV writes stay rare.
        try {
            if ((await env.SESSIONS.get(KV_BACKUP_KEY)) !== text) await env.SESSIONS.put(KV_BACKUP_KEY, text);
        } catch { /* the backup is optional */ }
        return vars;
    } catch (e: any) {
        console.log("gist load failed:", e?.message ?? e);
        if (cache && cache.url === url) return cache.vars;
        try {
            const backup = await env.SESSIONS.get(KV_BACKUP_KEY);
            if (backup) return parseVars(backup);
        } catch { /* nothing else to try */ }
        return {};
    }
}

/**
 * Returns `env` with the gist values merged in. Call it once at the start of every entry point
 * (fetch handler, Durable Object) and pass the result on instead of the raw env.
 */
export async function loadEnv(raw: Env): Promise<Env> {
    const url = String(raw.GIST_URL ?? "").trim();
    if (!url) return raw; // no gist configured: behave exactly like before (values set in Cloudflare)

    const now = Date.now();
    let vars: Record<string, string>;
    if (cache && cache.url === url && now - cache.at < CACHE_MS) {
        vars = cache.vars;
    } else {
        vars = await fetchGist(raw, url);
        cache = { url, vars, at: now };
    }

    const merged: Env = { ...raw };
    for (const key of ["API_ID", "API_HASH", "BOT_TOKEN", "BIN_CHANNEL", "ADMIN_IDS", "WORKER_URL"] as const) {
        if (vars[key]) merged[key] = vars[key];
    }
    merged.MIRROR_BOT_TOKENS = mirrorTokens(vars);
    return merged;
}
