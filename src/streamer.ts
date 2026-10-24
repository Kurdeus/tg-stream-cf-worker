import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import bigInt from "big-integer";
import { Buffer } from "node:buffer";

/**
 * v2.0 CLASSIC MTPROTO (REVERTED)
 * Standard GramJS / WASM implementation.
 * Pure proxy path for all files.
 */

function toBuffer(data: any): Buffer {
    if (data?.type === "Buffer" && Array.isArray(data.data)) return Buffer.from(data.data);
    return Buffer.from(data);
}

/**
 * One fresh MTProto connection PER REQUEST.
 * Workers do not allow an I/O object (the websocket) created in one request to be used by
 * another one, so a shared global client breaks as soon as the downloader reconnects.
 * The login session is kept in KV, so a new connection costs only a short handshake.
 */
async function newClient(env: any): Promise<TelegramClient> {
    // A wrong API_ID otherwise surfaces as a cryptic 32-bit "out of range" error deep inside GramJS.
    const apiId = Number(env.API_ID);
    if (!Number.isInteger(apiId) || apiId <= 0 || apiId > 2147483647) {
        throw new Error(
            `API_ID is invalid (${String(env.API_ID ?? "").length} digits given). ` +
            `Use the numeric "App api_id" from https://my.telegram.org (usually 7-8 digits). ` +
            `It is NOT the bot id, the bot token or a Telegram user id.`
        );
    }
    const sessionKey = "session:gramjs:" + env.BOT_TOKEN;
    const savedSession = await env.SESSIONS.get(sessionKey);

    const client = new TelegramClient(new StringSession(savedSession || ""), apiId, env.API_HASH, {
        connectionRetries: 5,
        useWSS: true,
        autoReconnect: false
    } as any);

    client.setLogLevel("none" as any);
    if (savedSession) {
        await client.connect();
    } else {
        await client.start({ botAuthToken: env.BOT_TOKEN });
        await env.SESSIONS.put(sessionKey, (client.session as StringSession).save());
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
 */
const hashCache = new Map<string, any>();

async function getBinMessages(client: TelegramClient, cid: string | number, mid: number) {
    const raw = String(cid).replace(/^-100/, "").replace(/^-/, "");
    const channelId = bigInt(raw);

    let accessHash = hashCache.get(raw);
    if (accessHash === undefined) {
        const res: any = await client.invoke(new Api.channels.GetChannels({
            id: [new Api.InputChannel({ channelId: channelId as any, accessHash: bigInt(0) as any })],
        }));
        const chat = (res.chats || []).find((c: any) => String(c.id) === raw) || (res.chats || [])[0];
        if (!chat || chat.accessHash === undefined) {
            throw new Error("Bot cannot access BIN_CHANNEL. Make sure it is an admin of that channel.");
        }
        accessHash = chat.accessHash;
        hashCache.set(raw, accessHash);
    }

    const peer = new Api.InputPeerChannel({ channelId: channelId as any, accessHash });
    return await client.getMessages(peer as any, { ids: [mid] });
}

export async function handleStream(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.pathname.split("/").pop();
    if (!fileId) return new Response("ID Missing", { status: 400 });

    const fileName = url.searchParams.get("name") || "file";

    let client: TelegramClient | null = null;
    try {
        const mappingStr = await (env.FILE_MAP ?? env.SESSIONS).get(fileId);
        if (!mappingStr) return new Response("Link Expired.", { status: 404 });
        const mapping = JSON.parse(mappingStr);
        const { cid, mid } = mapping;

        client = await newClient(env);

        // Always read the message fresh: file references expire, so caching them in KV breaks old links.
        const messages = await getBinMessages(client, cid, mid);
        const media = messages?.[0]?.media as any;
        if (!media || !media.document) return new Response("File not found.", { status: 404 });
        const doc = media.document;

        const totalSize = Number(doc.size);
        const rangeHeader = request.headers.get("Range");

        let start = 0, end = totalSize - 1;
        if (rangeHeader) {
            const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
            if (m) {
                if (m[1] === "" && m[2] !== "") { // suffix range: last N bytes
                    start = Math.max(0, totalSize - parseInt(m[2], 10));
                } else {
                    if (m[1] !== "") start = parseInt(m[1], 10);
                    if (m[2] !== "") end = Math.min(parseInt(m[2], 10), totalSize - 1);
                }
            }
            if (start >= totalSize || start > end) {
                return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
            }
        }

        const contentLength = end - start + 1;
        const rid = Math.random().toString(36).slice(2, 6);
        console.log(`[dl ${rid}] start range=${rangeHeader ?? "none"} bytes=${start}-${end}/${totalSize}`);
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
        const MAX_RETRIES = 6;

        // Pull-based stream: Telegram is only read as fast as the client consumes it.
        // If Telegram stalls / times out / drops the socket, reconnect and RESUME from the
        // exact byte we reached, so the browser never notices.
        const stream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    try {
                        const { value, done } = await iterator.next();
                        if (done) {
                            if (sent < contentLength) throw new Error(`Telegram ended early at ${sent}/${contentLength} bytes`);
                            console.log(`[dl ${rid}] complete sent=${sent}`);
                            controller.close();
                            await closeClient(client);
                            return;
                        }
                        let chunk = new Uint8Array(value as any);
                        const remaining = contentLength - sent;
                        if (chunk.length >= remaining) {
                            chunk = chunk.subarray(0, remaining);
                            controller.enqueue(chunk);
                            sent += chunk.length;
                            console.log(`[dl ${rid}] complete sent=${sent}`);
                            controller.close();
                            try { await iterator.return?.(); } catch { }
                            await closeClient(client);
                            return;
                        }
                        controller.enqueue(chunk);
                        sent += chunk.length;
                        attempts = 0; // progress made, so reset the retry budget
                        return;
                    } catch (e: any) {
                        const msg = `${new Date().toISOString()} offset=${start + sent} sent=${sent}/${contentLength} retry=${attempts}/${MAX_RETRIES} :: ${e?.message ?? e}`;
                        console.log(`[dl ${rid}] ERROR ${msg}`);
                        try { await env.SESSIONS.put("debug:last_stream_error", msg); } catch { }
                        if (attempts >= MAX_RETRIES) { controller.error(e); await closeClient(client); return; }
                        attempts++;
                        try { await iterator.return?.(); } catch { }
                        await sleep(400 * attempts);
                        try {
                            await closeClient(client);
                            client = await newClient(env);
                            iterator = makeIterator(start + sent);
                        } catch (e2: any) {
                            if (attempts >= MAX_RETRIES) { controller.error(e2); await closeClient(client); return; }
                        }
                    }
                }
            },
            async cancel() {
                // Runs when the DOWNLOADER (ADM / network / VPN) closed the connection, not the worker.
                console.log(`[dl ${rid}] CLIENT CLOSED connection at byte ${start + sent} (sent ${sent}/${contentLength})`);
                try { await iterator.return?.(); } catch { }
                await closeClient(client);
            }
        }, { highWaterMark: 2 });

        const headers: Record<string, string> = {
            "Content-Type": doc.mimeType || "application/octet-stream",
            "Accept-Ranges": "bytes",
            "Content-Length": String(contentLength),
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Content-Type",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
        };

        if (rangeHeader) {
            headers["Content-Range"] = `bytes ${start}-${end}/${totalSize}`;
            return new Response(stream, { status: 206, headers });
        }
        return new Response(stream, { status: 200, headers });

    } catch (error: any) {
        const msg = `${new Date().toISOString()} (before stream) :: ${error?.message ?? error}`;
        console.log("[dl] ERROR " + msg);
        try { await env.SESSIONS.put("debug:last_stream_error", msg); } catch { }
        await closeClient(client);
        return new Response("Streaming Error: " + (error?.message ?? error), { status: 500 });
    }
}
