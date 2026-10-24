import { handleStream } from "./streamer";
import { T, Lang, PICK_LANGUAGE_TEXT, langKeyboard, changeLangKeyboard, langFromCode, humanSize, escapeHtml } from "./messages";

export interface Env {
    SESSIONS: KVNamespace;
    FILE_MAP?: KVNamespace; // optional: old deployments keep it, new ones use SESSIONS for everything
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
const COMMANDS_VERSION = "3";
// Bump when allowed_updates changes so existing deployments re-register their webhook once.
const WEBHOOK_VERSION = "2";
const ALLOWED_UPDATES = ["message", "edited_message", "callback_query"];

async function ensureCommands(env: Env, force = false): Promise<void> {
    const key = "commands:version";
    if (!force && (await env.SESSIONS.get(key)) === COMMANDS_VERSION) return;
    const en = await tg(env, "setMyCommands", { commands: T.en.commands });
    const fa = await tg(env, "setMyCommands", { commands: T.fa.commands, language_code: "fa" });
    if (en.ok && fa.ok) await env.SESSIONS.put(key, COMMANDS_VERSION);
}

// ---- Per-user language ---------------------------------------------------------------------
async function getSavedLang(env: Env, userId: number | string): Promise<Lang | null> {
    const v = await env.SESSIONS.get(`lang:${userId}`);
    return v === "fa" || v === "en" ? v : null;
}

async function getLang(env: Env, userId: number | string, telegramCode?: string): Promise<Lang> {
    return (await getSavedLang(env, userId)) ?? langFromCode(telegramCode);
}

async function setLang(env: Env, userId: number | string, lang: Lang): Promise<void> {
    await env.SESSIONS.put(`lang:${userId}`, lang);
}

async function ensureWebhook(env: Env, origin: string, force = false): Promise<any> {
    const hookUrl = `${origin}/bot${env.BOT_TOKEN}`;
    const secret = (await sha256Hex("secret:" + env.BOT_TOKEN)).slice(0, 48);
    const stateKey = "webhook:url";
    const stateValue = `${hookUrl}|v${WEBHOOK_VERSION}`;

    if (!force) {
        const current = await env.SESSIONS.get(stateKey);
        if (current === stateValue) {
            await ensureCommands(env);
            return { ok: true, skipped: true };
        }
    }

    const res = await tg(env, "setWebhook", {
        url: hookUrl,
        secret_token: secret,
        allowed_updates: ALLOWED_UPDATES,
        // Only throw queued updates away when repairing a wrong webhook, not on a silent upgrade.
        drop_pending_updates: force,
        max_connections: 40,
    });

    if (res.ok) {
        await env.SESSIONS.put(stateKey, stateValue);
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

                // This page is public, so it must be safe to open repeatedly: it only touches the
                // webhook when Telegram is NOT pointing at this worker (first run, or another
                // worker took the bot over).
                const me = await tg(env, "getMe");
                let info = await tg(env, "getWebhookInfo");
                let setHook: any = { ok: true, skipped: true };
                const allowed = info?.result?.allowed_updates;
                const missingButtons = Array.isArray(allowed) && !allowed.includes("callback_query");
                if (info?.result?.url !== `${origin}/bot${env.BOT_TOKEN}` || missingButtons) {
                    setHook = await ensureWebhook(env, origin, true);
                    info = await tg(env, "getWebhookInfo");
                }
                const hasUrl = !!info?.result?.url;

                // Credentials that are present but wrong are the most common "it deploys but nothing works" cause.
                const apiIdStr = String(env.API_ID ?? "");
                let apiIdCheck = "OK";
                if (!/^\d{1,10}$/.test(apiIdStr) || Number(apiIdStr) <= 0 || Number(apiIdStr) > 2147483647) {
                    apiIdCheck = `invalid: must be the numeric App api_id from my.telegram.org, usually 7-8 digits (${apiIdStr.length} characters given)`;
                } else if (me?.result?.id && apiIdStr === String(me.result.id)) {
                    apiIdCheck = "invalid: this is the bot's own id, not the App api_id";
                }
                const apiHashCheck = /^[0-9a-f]{32}$/i.test(String(env.API_HASH ?? "")) ? "OK" : "invalid: must be 32 hex characters from my.telegram.org";

                let binCheck: any = "BIN_CHANNEL not set";
                if (env.BIN_CHANNEL) {
                    const m = await tg(env, "getChatMember", { chat_id: env.BIN_CHANNEL, user_id: me?.result?.id });
                    binCheck = m.ok
                        ? { bot_status_in_channel: m.result.status }
                        : { error: m.description };
                }

                const lastStreamError = await env.SESSIONS.get("debug:last_stream_error");

                return json({
                    ok: !!setHook.ok && hasUrl && missing.length === 0 && apiIdCheck === "OK" && apiHashCheck === "OK",
                    missing_secrets: missing,
                    api_id: apiIdCheck,
                    api_hash: apiHashCheck,
                    bot: me?.result?.username ?? me?.description,
                    set_webhook: setHook.skipped ? "already registered" : (setHook.ok ? "registered now" : setHook.description),
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

async function sendLanguagePicker(env: Env, chatId: number | string): Promise<void> {
    await tg(env, "sendMessage", {
        chat_id: chatId,
        text: PICK_LANGUAGE_TEXT,
        reply_markup: langKeyboard(),
    });
}

/** Handles presses on the inline buttons (language picker and the "change language" button). */
async function handleCallback(cq: any, env: Env): Promise<void> {
    const m = /^lang:(fa|en|menu)$/.exec(String(cq.data ?? ""));
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;

    if (!m) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
        return;
    }

    if (m[1] === "menu") {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
        if (chatId !== undefined && messageId !== undefined) {
            await tg(env, "editMessageText", {
                chat_id: chatId,
                message_id: messageId,
                text: PICK_LANGUAGE_TEXT,
                reply_markup: langKeyboard(),
            });
        }
        return;
    }

    const lang = m[1] as Lang;
    await setLang(env, cq.from.id, lang);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: T[lang].langSet });
    if (chatId !== undefined && messageId !== undefined) {
        await tg(env, "editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text: T[lang].start,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: changeLangKeyboard(lang),
        });
    }
}

async function handleUpdate(update: any, env: Env, ctx: ExecutionContext, origin: string): Promise<void> {
    if (update.callback_query) {
        await handleCallback(update.callback_query, env);
        return;
    }

    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const userId = message.from?.id ?? chatId;

    const text: string = message.text || "";
    const cmd = /^\/(start|help|info|language|lang)(@\w+)?(\s|$)/i.exec(text)?.[1]?.toLowerCase();
    if (cmd) {
        if (cmd === "language" || cmd === "lang") {
            await sendLanguagePicker(env, chatId);
            return;
        }

        const saved = await getSavedLang(env, userId);

        // First /start: let the person choose before anything else. They can change it later with /language.
        if (cmd === "start" && !saved) {
            await sendLanguagePicker(env, chatId);
            return;
        }

        const lang = saved ?? langFromCode(message.from?.language_code);
        const t = T[lang];
        await tg(env, "sendMessage", {
            chat_id: chatId,
            text: cmd === "start" ? t.start : cmd === "help" ? t.help : t.info,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...(cmd === "start" ? { reply_markup: changeLangKeyboard(lang) } : {}),
        });
        return;
    }

    const media = message.document || message.video || message.audio || message.voice || message.video_note || message.animation;
    if (!media) return;

    const lang = await getLang(env, userId, message.from?.language_code);
    const t = T[lang];

    if (!env.BIN_CHANNEL) {
        await tg(env, "sendMessage", {
            chat_id: chatId,
            text: t.setupIncomplete,
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
            text: t.storeFailed(String(copied.description ?? "unknown error")),
            reply_to_message_id: messageId,
        });
        return;
    }

    // File keys are base64url (no ':'), every other key we store contains ':', so one namespace is enough.
    await (env.FILE_MAP ?? env.SESSIONS).put(fileId, JSON.stringify({
        cid: env.BIN_CHANNEL,
        mid: copied.result.message_id,
        size: media.file_size,
    }));

    const base = env.WORKER_URL ? new URL(env.WORKER_URL).origin : origin;
    const directLink = `${base}/dl/${fileId}?name=${encodeURIComponent(fileName)}`;

    const size = humanSize(media.file_size);
    await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `📎 <b>${escapeHtml(fileName)}</b>${size ? `\n📦 ${size}` : ""}\n\n${t.linkHeader}\n${directLink}`,
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
