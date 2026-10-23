import { handleStream } from "./streamer";
import { BOT_COMMANDS, START_TEXT, HELP_TEXT, INFO_TEXT, humanSize, escapeHtml } from "./messages";

export interface Env {
    SESSIONS: KVNamespace;
    FILE_MAP: KVNamespace;
    API_ID: string;
    API_HASH: string;
    BOT_TOKEN: string;
    WORKER_URL?: string;
    BIN_CHANNEL?: string;
    STREAMER: DurableObjectNamespace;
}

async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function tg(env: Env, method: string, payload?: unknown): Promise<any> {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}

/**
 * Registers the Telegram webhook (idempotent).
 * This is the step that was missing: without a webhook Telegram never
 * delivers messages to the Worker, so the bot looks "active" but is silent.
 */
const COMMANDS_VERSION = "2";

async function ensureCommands(env: Env, force = false): Promise<void> {
    const key = "commands:version";
    if (!force && (await env.SESSIONS.get(key)) === COMMANDS_VERSION) return;
    const r = await tg(env, "setMyCommands", { commands: BOT_COMMANDS });
    if (r.ok) await env.SESSIONS.put(key, COMMANDS_VERSION);
}

async function ensureWebhook(env: Env, origin: string, force = false): Promise<any> {
    const hookUrl = `${origin}/bot${env.BOT_TOKEN}`;
    const secret = (await sha256Hex("secret:" + env.BOT_TOKEN)).slice(0, 48);
    const stateKey = "webhook:url";

    if (!force) {
        const current = await env.SESSIONS.get(stateKey);
        if (current === hookUrl) {
            await ensureCommands(env);
            return { ok: true, skipped: true };
        }
    }

    const res = await tg(env, "setWebhook", {
        url: hookUrl,
        secret_token: secret,
        allowed_updates: ["message", "edited_message"],
        drop_pending_updates: true,
        max_connections: 40,
    });

    if (res.ok) {
        await env.SESSIONS.put(stateKey, hookUrl);
        await ensureCommands(env, true);
    }
    return res;
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
    });
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const origin = url.origin;
        const botPath = "/bot" + env.BOT_TOKEN;

        try {
            // ---- Health + lazy auto-setup -------------------------------------------------
            if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
                if (env.BOT_TOKEN) ctx.waitUntil(ensureWebhook(env, origin).catch(() => { }));
                return new Response("Bot Active.", { status: 200 });
            }

            // ---- Manual setup / diagnostics ----------------------------------------------
            // Open  https://YOUR-WORKER/setup  in a browser to (re)register and see the status.
            if (url.pathname === "/setup") {
                const missing = ["API_ID", "API_HASH", "BOT_TOKEN", "BIN_CHANNEL"].filter(k => !(env as any)[k]);
                if (!env.BOT_TOKEN) return json({ ok: false, missing_secrets: missing }, 500);

                const me = await tg(env, "getMe");
                const setHook = await ensureWebhook(env, origin, true);
                const info = await tg(env, "getWebhookInfo");
                const hasUrl = !!info?.result?.url;

                let binCheck: any = "BIN_CHANNEL not set";
                if (env.BIN_CHANNEL) {
                    const m = await tg(env, "getChatMember", { chat_id: env.BIN_CHANNEL, user_id: me?.result?.id });
                    binCheck = m.ok
                        ? { bot_status_in_channel: m.result.status }
                        : { error: m.description };
                }

                const lastStreamError = await env.SESSIONS.get("debug:last_stream_error");

                return json({
                    ok: !!setHook.ok && hasUrl && missing.length === 0,
                    missing_secrets: missing,
                    bot: me?.result?.username ?? me?.description,
                    set_webhook: setHook.ok ? "OK" : setHook.description,
                    webhook_registered: hasUrl,
                    pending_updates: info?.result?.pending_update_count,
                    last_error: info?.result?.last_error_message ?? null,
                    bin_channel: binCheck,
                    last_stream_error: lastStreamError,
                });
            }

            // ---- Telegram webhook ------------------------------------------------------------
            if (request.method === "POST" && url.pathname === botPath) {
                const expected = (await sha256Hex("secret:" + env.BOT_TOKEN)).slice(0, 48);
                const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
                if (got !== expected) return new Response("Forbidden", { status: 403 });

                try {
                    await handleUpdate(await request.json() as any, env, ctx, origin);
                } catch (e: any) {
                    // Always answer 200, otherwise Telegram keeps retrying and the queue jams.
                    console.log("update error:", e?.message ?? e);
                }
                return new Response("OK");
            }

            // ---- File download -----------------------------------------------------------------
            // The heavy part (MTProto decryption) runs inside a Durable Object, because a
            // Durable Object invocation gets a much larger CPU budget than a plain Worker request.
            // The Worker itself only forwards the (already streaming) response.
            if (url.pathname.startsWith("/dl/")) {
                const stub = env.STREAMER.get(env.STREAMER.newUniqueId());
                return await stub.fetch(request);
            }

            return new Response("Not Found", { status: 404 });
        } catch (e: any) {
            return new Response("Worker Error: " + e.message, { status: 500 });
        }
    },
};

async function handleUpdate(update: any, env: Env, ctx: ExecutionContext, origin: string): Promise<void> {
    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = message.chat.id;
    const messageId = message.message_id;

    const text: string = message.text || "";
    const cmd = /^\/(start|help|info)(@\w+)?(\s|$)/i.exec(text)?.[1]?.toLowerCase();
    if (cmd) {
        const body = cmd === "start" ? START_TEXT : cmd === "help" ? HELP_TEXT : INFO_TEXT;
        await tg(env, "sendMessage", {
            chat_id: chatId,
            text: body,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
        });
        return;
    }

    const media = message.document || message.video || message.audio || message.voice || message.video_note || message.animation;
    if (!media) return;

    if (!env.BIN_CHANNEL) {
        await tg(env, "sendMessage", {
            chat_id: chatId,
            text: "Server setup incomplete: BIN_CHANNEL secret is not set.",
            reply_to_message_id: messageId,
        });
        return;
    }

    const fileId = media.file_id;
    const fileName = media.file_name || (message.video ? "video.mp4" : message.audio ? "audio.mp3" : "file");

    // Copy the file to the private bin channel BEFORE answering,
    // so the link already works when the user clicks it.
    const copied = await tg(env, "copyMessage", {
        chat_id: env.BIN_CHANNEL,
        from_chat_id: chatId,
        message_id: messageId,
    });

    if (!copied.ok) {
        await tg(env, "sendMessage", {
            chat_id: chatId,
            text: `Could not store the file in BIN_CHANNEL.\nTelegram says: ${copied.description}\n\nMake sure the bot is an ADMIN of that channel and BIN_CHANNEL is the correct id (e.g. -100123456789).`,
            reply_to_message_id: messageId,
        });
        return;
    }

    await env.FILE_MAP.put(fileId, JSON.stringify({
        cid: env.BIN_CHANNEL,
        mid: copied.result.message_id,
        size: media.file_size,
    }));

    const base = env.WORKER_URL ? new URL(env.WORKER_URL).origin : origin;
    const directLink = `${base}/dl/${fileId}?name=${encodeURIComponent(fileName)}`;

    const size = humanSize(media.file_size);
    await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `📎 <b>${escapeHtml(fileName)}</b>${size ? `\n📦 ${size}` : ""}\n\n🔗 لینک مستقیم دانلود:\n${directLink}`,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_to_message_id: messageId,
    });
}

/** One short-lived instance per download request. */
export class StreamerDO {
    private env: Env;
    constructor(_state: DurableObjectState, env: Env) {
        this.env = env;
    }
    async fetch(request: Request): Promise<Response> {
        return handleStream(request, this.env);
    }
}
