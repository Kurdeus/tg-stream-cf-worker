import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import bigInt from "big-integer";
import { Buffer } from "node:buffer";
import { Candidate, Failure, getCandidates, classifyError, cooldownFor, setCooldown, sessionKey } from "./bots";
import { guardCall, BEAT_MS } from "./guard";

/**
 * Streams a file that is stored in the private BIN_CHANNEL straight to the downloader.
 *
 * Several bot accounts can take part: the main bot first and, when it is rate limited
 * (FLOOD_WAIT) or fails, the helper bots that the admin added in the /admin panel.
 * A download that is already running is resumed from the exact byte on the next bot.
 */

function toBuffer(data: any): Buffer {
    if (data?.type === "Buffer" && Array.isArray(data.data)) return Buffer.from(data.data);
    return Buffer.from(data);
}

/**
 * One fresh MTProto connection PER REQUEST (and per bot).
 * Workers do not allow an I/O object (the websocket) created in one request to be used by
 * another one, so a shared global client breaks as soon as the downloader reconnects.
 * The login session is kept in KV, so a new connection costs only a short handshake.
 */
async function newClient(env: any, token: string): Promise<TelegramClient> {
    // A wrong API_ID otherwise surfaces as a cryptic 32-bit "out of range" error deep inside GramJS.
    const apiId = Number(env.API_ID);
    if (!Number.isInteger(apiId) || apiId <= 0 || apiId > 2147483647) {
        throw new Error(
            `API_ID is invalid (${String(env.API_ID ?? "").length} digits given). ` +
            `Use the numeric "App api_id" from https://my.telegram.org (usually 7-8 digits). ` +
            `It is NOT the bot id, the bot token or a Telegram user id.`
        );
    }
    const key = sessionKey(token);
    const savedSession = await env.SESSIONS.get(key);

    const client = new TelegramClient(new StringSession(savedSession || ""), apiId, env.API_HASH, {
        connectionRetries: 5,
        useWSS: true,
        autoReconnect: false,
        // 0 = never sleep inside GramJS on FLOOD_WAIT, throw at once so we can switch to the next bot.
        floodSleepThreshold: 0,
    } as any);

    client.setLogLevel("none" as any);
    if (savedSession) {
        await client.connect();
    } else {
        await client.start({ botAuthToken: token });
        await env.SESSIONS.put(key, (client.session as StringSession).save());
    }
    return client;
}

async function closeClient(c: TelegramClient | null | undefined): Promise<void> {
    if (!c) return;
    try { await c.disconnect(); } catch { }
    try { await (c as any).destroy?.(); } catch { }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * A bot cannot list dialogs, so the bin channel is not in GramJS's entity cache and a message
 * lookup fails with CHANNEL_INVALID. Ask Telegram for the channel (access_hash 0 is accepted
 * for bots that are members), then use the REAL access_hash it returns.
 * access_hash values are specific to each bot account, so the cache is keyed per bot.
 */
const hashCache = new Map<string, any>();
const cacheStats = { hit: 0, miss: 0 };

function takeCacheStats() {
    const d = { hit: cacheStats.hit, miss: cacheStats.miss };
    cacheStats.hit = 0;
    cacheStats.miss = 0;
    return d;
}

/** Sends the cache counters when there is no download connection to carry them (HEAD, early errors). */
async function flushCacheStats(env: any): Promise<void> {
    const d = takeCacheStats();
    if ((d.hit || d.miss) && !(await guardCall(env, "add", d))) { cacheStats.hit += d.hit; cacheStats.miss += d.miss; }
}

async function getBinMessages(client: TelegramClient, botId: string, cid: string | number, mid: number) {
    const raw = String(cid).replace(/^-100/, "").replace(/^-/, "");
    const channelId = bigInt(raw);
    const cacheKey = `${botId}:${raw}`;

    let accessHash = hashCache.get(cacheKey);
    if (accessHash === undefined) {
        cacheStats.miss++;
        const res: any = await client.invoke(new Api.channels.GetChannels({
            id: [new Api.InputChannel({ channelId: channelId as any, accessHash: bigInt(0) as any })],
        }));
        const chat = (res.chats || []).find((c: any) => String(c.id) === raw) || (res.chats || [])[0];
        if (!chat || chat.accessHash === undefined) {
            throw new Error("Bot cannot access BIN_CHANNEL. Make sure it is an admin of that channel.");
        }
        accessHash = chat.accessHash;
        hashCache.set(cacheKey, accessHash);
    } else {
        cacheStats.hit++;
    }

    const peer = new Api.InputPeerChannel({ channelId: channelId as any, accessHash });
    return await client.getMessages(peer as any, { ids: [mid] });
}

/** Remember that a bot should be avoided for a while (and drop its login if that is what broke). */
async function recordFailure(env: any, cand: Candidate, f: Failure): Promise<void> {
    try {
        if (f.kind === "session") await env.SESSIONS.delete(sessionKey(cand.token));
        const ms = cooldownFor(f);
        if (ms > 0) await setCooldown(env, cand.key, Date.now() + ms);
        if (f.kind === "flood") await guardCall(env, "flood", { key: cand.key, seconds: f.seconds });
    } catch { /* bookkeeping must never break a download */ }
}

/** One running download connection, as the guard sees it. */
interface Lease { addBytes(n: number): void; release(): Promise<void> }

/**
 * Asks the guard for permission to start a download connection (limits per IP and per file).
 * Returns null when the limit is reached. If the guard cannot be reached the download is allowed.
 * While the lease is open it reports every BEAT_MS, so a connection that died without
 * releasing is forgotten by the guard after a short time.
 */
async function openLease(env: any, ip: string, file: string): Promise<Lease | null> {
    const id = crypto.randomUUID();
    const r = await guardCall(env, "acquire", { id, ip, file });
    if (r && r.ok === false) return null;

    let bytes = 0;
    let closed = false;
    const send = async (op: "beat" | "release") => {
        const d = { bytes, ...takeCacheStats() };
        bytes = 0;
        if (!(await guardCall(env, op, { id, ip, file, ...d }))) {
            bytes += d.bytes; cacheStats.hit += d.hit; cacheStats.miss += d.miss;
        }
    };
    const timer = setInterval(() => { void send("beat"); }, BEAT_MS);
    return {
        addBytes(n) { bytes += n; },
        async release() {
            if (closed) return;
            closed = true;
            clearInterval(timer);
            await send("release");
        },
    };
}

export type ByteRange = { kind: "none" } | { kind: "unsatisfiable" } | { kind: "range"; start: number; end: number };

/**
 * Reads a Range header (RFC 7233). A header that is missing, malformed, asks for several ranges or has
 * its last byte before its first byte is ignored, which means the whole file is sent with status 200.
 * A range that starts past the end of the file is "unsatisfiable" (status 416).
 */
export function parseRange(header: string | null, totalSize: number): ByteRange {
    const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header ?? "");
    if (!m || (m[1] === "" && m[2] === "")) return { kind: "none" };
    if (m[1] === "") { // suffix range: the last N bytes
        const n = Number(m[2]);
        if (n === 0 || totalSize === 0) return { kind: "unsatisfiable" };
        return { kind: "range", start: Math.max(0, totalSize - n), end: totalSize - 1 };
    }
    const start = Number(m[1]);
    if (m[2] !== "" && Number(m[2]) < start) return { kind: "none" };
    if (start >= totalSize) return { kind: "unsatisfiable" };
    return { kind: "range", start, end: m[2] === "" ? totalSize - 1 : Math.min(Number(m[2]), totalSize - 1) };
}

/**
 * If-Range: the Range header may only be used when the file is still the one the downloader started with.
 * An entity tag must match exactly (weak tags never do), a date must be the same moment as Last-Modified.
 */
export function ifRangeMatches(ifRange: string | null, etag: string, lastModified: string | null): boolean {
    const v = (ifRange ?? "").trim();
    if (!v) return true;
    if (v.startsWith('"') || v.startsWith("W/")) return v === etag;
    const t = Date.parse(v);
    return lastModified !== null && !Number.isNaN(t) && t === Date.parse(lastModified);
}

interface Acquired { client: TelegramClient; doc: any; idx: number }

/**
 * Connect with the first bot (starting at startIdx) that can read the stored message.
 * The document is read again for every bot, because file references and access hashes
 * are only valid for the account that fetched them.
 */
async function acquire(env: any, cands: Candidate[], startIdx: number, cid: string | number, mid: number): Promise<Acquired> {
    let last: any = null;
    for (let i = 0; i < cands.length; i++) {
        const idx = (startIdx + i) % cands.length;
        const cand = cands[idx];
        let client: TelegramClient | null = null;
        try {
            client = await newClient(env, cand.token);
            const messages = await getBinMessages(client, cand.key, cid, mid);
            const media = messages?.[0]?.media as any;
            if (!media?.document) {
                const nf: any = new Error("File not found.");
                nf.notFound = true;
                throw nf;
            }
            return { client, doc: media.document, idx };
        } catch (e: any) {
            await closeClient(client);
            if (e?.notFound) throw e;
            const f = classifyError(e);
            console.log(`[dl] ${cand.label} failed (${f.kind}): ${e?.message ?? e}`);
            if (f.kind === "fatal") throw e;
            await recordFailure(env, cand, f);
            last = e;
        }
    }
    const err: any = new Error(`All ${cands.length} bot(s) failed. Last error: ${last?.message ?? last}`);
    err.__recorded = true; // every bot already got its cooldown above
    throw err;
}

export async function handleStream(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.pathname.split("/").pop();
    if (!fileId) return new Response("ID Missing", { status: 400 });

    const fileName = url.searchParams.get("name") || "file";

    let client: TelegramClient | null = null;
    let lease: Lease | null = null;
    try {
        const mappingStr = await (env.FILE_MAP ?? env.SESSIONS).get(fileId);
        if (!mappingStr) return new Response("Link Expired.", { status: 404 });
        const mapping = JSON.parse(mappingStr);
        const { cid, mid } = mapping;

        // HEAD probes are not downloads, so they do not count against the connection limits.
        if (request.method !== "HEAD") {
            lease = await openLease(env, request.headers.get("CF-Connecting-IP") ?? "", fileId);
            if (!lease) {
                return new Response("Too many connections. Try again in a few seconds.", { status: 429, headers: { "Retry-After": "5" } });
            }
        }

        const cands = await getCandidates(env);
        const first = await acquire(env, cands, 0, cid, mid);
        client = first.client;
        let doc: any = first.doc; // re-read whenever we switch to another bot
        let idx = first.idx;

        const totalSize = Number(doc.size);
        const rangeHeader = request.headers.get("Range");

        // Validators let a downloader check, before it resumes, that the file did not change.
        // The Telegram document id never changes for a stored file, so it serves as the ETag.
        const etag = `"${String(doc.id)}"`;
        const lastModified = typeof doc.date === "number" && doc.date > 0 ? new Date(doc.date * 1000).toUTCString() : null;

        let range = parseRange(rangeHeader, totalSize);
        if (range.kind !== "none" && !ifRangeMatches(request.headers.get("If-Range"), etag, lastModified)) range = { kind: "none" };
        if (range.kind === "unsatisfiable") {
            await closeClient(client);
            await lease?.release();
            return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
        }
        const ranged = range.kind === "range";
        const start = range.kind === "range" ? range.start : 0;
        const end = range.kind === "range" ? range.end : totalSize - 1;

        const contentLength = end - start + 1;

        // RFC 6266: an ASCII fallback for old download managers plus the exact UTF-8 name for the rest.
        const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
        const utf8Name = encodeURIComponent(fileName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
        const headers: Record<string, string> = {
            "Content-Type": doc.mimeType || "application/octet-stream",
            "Accept-Ranges": "bytes",
            "Content-Length": String(contentLength),
            "Cache-Control": "public, max-age=3600",
            "ETag": etag,
            ...(lastModified ? { "Last-Modified": lastModified } : {}),
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Content-Type",
            "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`
        };
        if (ranged) headers["Content-Range"] = `bytes ${start}-${end}/${totalSize}`;
        const status = ranged ? 206 : 200;

        // Download managers often probe with HEAD first: answer with the headers only, no data transfer.
        if (request.method === "HEAD") {
            await closeClient(client);
            await flushCacheStats(env);
            return new Response(null, { status, headers });
        }

        const rid = Math.random().toString(36).slice(2, 6);
        console.log(`[dl ${rid}] start range=${rangeHeader ?? "none"} bytes=${start}-${end}/${totalSize} bot=${cands[idx].label} bots=${cands.length}`);
        const REQ = 512 * 1024; // bigger requests = fewer round-trips = less CPU per MB

        const makeIterator = (fromByte: number) => client!.iterDownload({
            file: new Api.InputDocumentFileLocation({
                id: bigInt(doc.id) as any,
                accessHash: bigInt(doc.accessHash) as any,
                fileReference: toBuffer(doc.fileReference) as any,
                thumbSize: ""
            }),
            dcId: doc.dcId,
            offset: bigInt(fromByte) as any,
            // "limit" is a number of CHUNKS (the old code passed bytes here)
            limit: Math.ceil((end - fromByte + 1 + (fromByte % REQ)) / REQ) + 1,
            requestSize: REQ,
            chunkSize: REQ,
        } as any)[Symbol.asyncIterator]();

        let iterator = makeIterator(start);
        let sent = 0;
        let attempts = 0;
        const MAX_RETRIES = Math.max(6, cands.length * 2);
        let needReconnect = false;
        let nextStart = idx;

        // Pull-based stream: Telegram is only read as fast as the client consumes it.
        // If Telegram stalls, rate-limits us or drops the socket, we move to the next bot
        // (or reconnect the same one) and RESUME from the exact byte we reached.
        const stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    try {
                        if (needReconnect) {
                            const r = await acquire(env, cands, nextStart, cid, mid);
                            client = r.client;
                            doc = r.doc;
                            idx = r.idx;
                            iterator = makeIterator(start + sent);
                            needReconnect = false;
                            console.log(`[dl ${rid}] resumed at byte ${start + sent} on ${cands[idx].label}`);
                        }

                        const { value, done } = await iterator.next();
                        if (done) {
                            if (sent < contentLength) throw new Error(`Telegram ended early at ${sent}/${contentLength} bytes`);
                            console.log(`[dl ${rid}] complete sent=${sent}`);
                            controller.close();
                            await closeClient(client);
                            await lease?.release();
                            return;
                        }
                        let chunk = new Uint8Array(value as any);
                        const remaining = contentLength - sent;
                        if (chunk.length >= remaining) {
                            chunk = chunk.subarray(0, remaining);
                            controller.enqueue(chunk);
                            sent += chunk.length;
                            lease?.addBytes(chunk.length);
                            console.log(`[dl ${rid}] complete sent=${sent}`);
                            controller.close();
                            try { await iterator.return?.(); } catch { }
                            await closeClient(client);
                            await lease?.release();
                            return;
                        }
                        controller.enqueue(chunk);
                        sent += chunk.length;
                        lease?.addBytes(chunk.length);
                        attempts = 0; // progress made, so reset the retry budget
                        return;
                    } catch (e: any) {
                        const f = classifyError(e);
                        const msg = `${new Date().toISOString()} offset=${start + sent} sent=${sent}/${contentLength} bot=${cands[idx].label} kind=${f.kind} retry=${attempts}/${MAX_RETRIES} :: ${e?.message ?? e}`;
                        console.log(`[dl ${rid}] ERROR ${msg}`);
                        try { await env.SESSIONS.put("debug:last_stream_error", msg); } catch { }
                        if (f.kind === "fatal" || e?.notFound || attempts >= MAX_RETRIES) {
                            controller.error(e);
                            await closeClient(client);
                            await lease?.release();
                            return;
                        }
                        attempts++;
                        if (!e?.__recorded) await recordFailure(env, cands[idx], f);
                        try { await iterator.return?.(); } catch { }
                        await closeClient(client);
                        client = null;

                        if (cands.length > 1) {
                            nextStart = (idx + 1) % cands.length; // hand over to the next bot at once
                        } else {
                            nextStart = idx;                      // only one bot: wait, then try it again
                            await sleep(f.kind === "flood" ? Math.min(f.seconds, 20) * 1000 : 400 * attempts);
                        }
                        needReconnect = true;
                    }
                }
            },
            async cancel() {
                // Runs when the DOWNLOADER (ADM / network / VPN) closed the connection, not the worker.
                console.log(`[dl ${rid}] CLIENT CLOSED connection at byte ${start + sent} (sent ${sent}/${contentLength})`);
                try { await iterator.return?.(); } catch { }
                await closeClient(client);
                await lease?.release();
            }
        }, { highWaterMark: 2 });

        return new Response(stream, { status, headers });

    } catch (error: any) {
        await closeClient(client);
        if (lease) await lease.release(); else await flushCacheStats(env);
        if (error?.notFound) return new Response("File not found.", { status: 404 });
        const msg = `${new Date().toISOString()} (before stream) :: ${error?.message ?? error}`;
        console.log("[dl] ERROR " + msg);
        try { await env.SESSIONS.put("debug:last_stream_error", msg); } catch { }
        return new Response("Streaming Error: " + (error?.message ?? error), { status: 500 });
    }
}
