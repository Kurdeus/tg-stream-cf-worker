/**
 * One global Durable Object (a single instance, found by name) that every download talks to.
 * It is the only place where "who is downloading right now" can be counted exactly, because KV
 * is eventually consistent and a Durable Object handles one event at a time. Everything it knows is
 * also written to the Durable Object's storage, because an idle instance is removed from memory
 * (between two heartbeats, for example) and must not forget the running downloads. It keeps:
 *  - the live connections (per IP and per file) and refuses new ones above the limits below,
 *  - the statistics shown in /admin (bytes sent, active connections, flood per bot, cache hits),
 *  - the bot cooldowns, so two requests can never overwrite each other's update.
 */

// Concurrent download connections allowed. Download managers open 8-16 per file, so these leave room
// for one manager per person while stopping a 32-connection burst from causing FLOOD_WAIT.
export const MAX_CONN_PER_IP = 16;
export const MAX_CONN_PER_FILE = 32;

const LEASE_MS = 90_000;      // a connection that stops reporting is forgotten after this long
export const BEAT_MS = 30_000; // how often a running download reports in

interface Lease { ip: string; file: string; exp: number }
interface Stats {
    bytes: number;
    hit: number;
    miss: number;
    floods: Record<string, { count: number; last: number; seconds: number }>;
}

/**
 * Calls the guard. Never throws: when the guard cannot be reached it returns null and the caller
 * carries on without it (statistics and limits must never break a download).
 */
export async function guardCall(env: { GUARD?: DurableObjectNamespace }, op: string, body: unknown = {}): Promise<any | null> {
    try {
        const stub = env.GUARD!.get(env.GUARD!.idFromName("main"));
        const res = await stub.fetch(`https://guard/${op}`, { method: "POST", body: JSON.stringify(body) });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

export class GuardDO {
    private leases = new Map<string, Lease>();
    private released = new Map<string, number>(); // finished connections, so a late heartbeat cannot revive them
    private stats: Stats = { bytes: 0, hit: 0, miss: 0, floods: {} };
    private cooldowns: Record<string, number> = {};

    constructor(private state: DurableObjectState, _env: unknown) {
        state.blockConcurrencyWhile(async () => {
            const saved = await state.storage.get<Stats>("stats");
            if (saved) this.stats = { bytes: 0, hit: 0, miss: 0, floods: {}, ...saved };
            this.cooldowns = (await state.storage.get<Record<string, number>>("cooldowns")) ?? {};
            this.leases = new Map(Object.entries((await state.storage.get<Record<string, Lease>>("leases")) ?? {}));
        });
    }

    private purge(now: number): void {
        for (const [id, l] of this.leases) if (l.exp <= now) this.leases.delete(id);
        for (const [id, exp] of this.released) if (exp <= now) this.released.delete(id);
        for (const [k, until] of Object.entries(this.cooldowns)) if (until <= now) delete this.cooldowns[k];
    }

    private saveLeases(): Promise<void> {
        return this.state.storage.put("leases", Object.fromEntries(this.leases));
    }

    private add(b: any): void {
        const n = (v: any) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
        this.stats.bytes += n(b.bytes);
        this.stats.hit += n(b.hit);
        this.stats.miss += n(b.miss);
    }

    async fetch(request: Request): Promise<Response> {
        const op = new URL(request.url).pathname.slice(1);
        const b: any = await request.json().catch(() => ({}));
        const now = Date.now();
        this.purge(now);
        const reply = (data: unknown) => Response.json(data);

        switch (op) {
            case "acquire": {
                const ip = String(b.ip ?? ""), file = String(b.file ?? "");
                let perIp = 0, perFile = 0;
                for (const l of this.leases.values()) {
                    if (ip && l.ip === ip) perIp++;
                    if (l.file === file) perFile++;
                }
                if (ip && perIp >= MAX_CONN_PER_IP) return reply({ ok: false, reason: "ip" });
                if (perFile >= MAX_CONN_PER_FILE) return reply({ ok: false, reason: "file" });
                this.leases.set(String(b.id), { ip, file, exp: now + LEASE_MS });
                await this.saveLeases();
                return reply({ ok: true });
            }
            case "beat": // also re-creates a connection the guard forgot (for example after a restart)
                if (!this.released.has(String(b.id))) {
                    this.leases.set(String(b.id), { ip: String(b.ip ?? ""), file: String(b.file ?? ""), exp: now + LEASE_MS });
                }
                this.add(b);
                await this.state.storage.put({ stats: this.stats, leases: Object.fromEntries(this.leases) });
                return reply({ ok: true });
            case "release":
                this.leases.delete(String(b.id));
                this.released.set(String(b.id), now + LEASE_MS);
                this.add(b);
                await this.state.storage.put({ stats: this.stats, leases: Object.fromEntries(this.leases) });
                return reply({ ok: true });
            case "add":
                this.add(b);
                await this.state.storage.put("stats", this.stats);
                return reply({ ok: true });
            case "flood": {
                const key = String(b.key);
                const prev = this.stats.floods[key];
                this.stats.floods[key] = { count: (prev?.count ?? 0) + 1, last: now, seconds: Number(b.seconds) || 0 };
                await this.state.storage.put("stats", this.stats);
                return reply({ ok: true });
            }
            case "stats":
                return reply({ active: this.leases.size, ...this.stats });
            case "cooldown.get":
                return reply({ map: this.cooldowns });
            case "cooldown.set": { // synchronous read-modify-write: no other request can run in between
                const key = String(b.key), until = Number(b.until);
                if (Number.isFinite(until)) this.cooldowns[key] = Math.max(until, this.cooldowns[key] ?? 0);
                await this.state.storage.put("cooldowns", this.cooldowns);
                return reply({ ok: true });
            }
            case "cooldown.clear":
                delete this.cooldowns[String(b.key)];
                await this.state.storage.put("cooldowns", this.cooldowns);
                return reply({ ok: true });
            default:
                return new Response("Not Found", { status: 404 });
        }
    }
}
