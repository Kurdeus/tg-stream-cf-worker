import type { Env } from "./env";
import { tg } from "./telegram";
import type { Lang } from "./messages";
import { A } from "./admin-messages";
import {
    getHelpers, saveHelpers, getCooldowns, getMode, setMode, botKey, sessionKey, clearCooldown, HelperBot,
} from "./bots";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/;
const stateKey = (userId: number | string) => `admin:await:${userId}`;

/** ADMIN_IDS = "123456, 789012" -> Set("123456", "789012") */
export function adminIds(env: Env): Set<string> {
    return new Set(String(env.ADMIN_IDS ?? "").split(/[\s,;]+/).filter(x => /^\d+$/.test(x)));
}
export function isAdmin(env: Env, userId: number | string): boolean {
    return adminIds(env).has(String(userId));
}

export async function isAwaitingToken(env: Env, userId: number | string): Promise<boolean> {
    return (await env.SESSIONS.get(stateKey(userId))) === "token";
}

// ---- views ---------------------------------------------------------------------------------
interface View { text: string; reply_markup: any }

async function panelView(env: Env, lang: Lang): Promise<View> {
    const a = A[lang];
    const [helpers, cooldowns, mode, me] = await Promise.all([getHelpers(env), getCooldowns(env), getMode(env), tg(env, "getMe")]);
    const cooling = helpers.filter(h => String(h.id) in cooldowns).length;
    return {
        text: a.panel(me?.result?.username ?? "?", helpers.length, cooling, mode),
        reply_markup: {
            inline_keyboard: [
                [{ text: a.btnAdd, callback_data: "adm:add" }, { text: a.btnList, callback_data: "adm:list" }],
                [{ text: a.btnCheck, callback_data: "adm:check" }, { text: a.btnMode(mode), callback_data: "adm:mode" }],
            ],
        },
    };
}

async function listView(env: Env, lang: Lang): Promise<View> {
    const a = A[lang];
    const [helpers, cooldowns] = await Promise.all([getHelpers(env), getCooldowns(env)]);
    const back = [{ text: a.btnBack, callback_data: "adm:menu" }];
    if (!helpers.length) return { text: `${a.listHeader}\n\n${a.listEmpty}`, reply_markup: { inline_keyboard: [back] } };

    const now = Date.now();
    const lines = helpers.map((h, i) => {
        const until = cooldowns[String(h.id)];
        const state = until ? a.cooling(Math.max(1, Math.ceil((until - now) / 1000))) : a.ready;
        return `${i + 1}. @${h.username} · <code>${h.id}</code> · ${state}`;
    });
    const rows: any[] = [];
    for (let i = 0; i < helpers.length; i += 2) {
        rows.push(helpers.slice(i, i + 2).map(h => ({ text: `🗑 @${h.username}`, callback_data: `adm:rm:${h.id}` })));
    }
    rows.push(back);
    return { text: `${a.listHeader}\n\n${lines.join("\n")}`, reply_markup: { inline_keyboard: rows } };
}

async function checkView(env: Env, lang: Lang): Promise<View> {
    const a = A[lang];
    const helpers = await getHelpers(env);
    const me = await tg(env, "getMe");
    const targets = [
        { label: `@${me?.result?.username ?? "main"} (main)`, id: me?.result?.id },
        ...helpers.map(h => ({ label: `@${h.username}`, id: h.id })),
    ];
    const lines = await Promise.all(targets.map(async (t) => {
        if (!env.BIN_CHANNEL) return a.checkFail(t.label, a.noBin);
        const r = await tg(env, "getChatMember", { chat_id: env.BIN_CHANNEL, user_id: t.id });
        if (!r.ok) return a.checkFail(t.label, String(r.description ?? "error"));
        return ["administrator", "creator"].includes(r.result?.status) ? a.checkOk(t.label) : a.checkFail(t.label, String(r.result?.status));
    }));
    return {
        text: `${a.checkHeader}\n\n${lines.join("\n")}`,
        reply_markup: { inline_keyboard: [[{ text: a.btnBack, callback_data: "adm:menu" }]] },
    };
}

const html = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };

async function edit(env: Env, chatId: any, messageId: any, view: View) {
    if (chatId === undefined || messageId === undefined) return;
    await tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: view.text, reply_markup: view.reply_markup, ...html });
}

async function send(env: Env, chatId: any, view: View) {
    await tg(env, "sendMessage", { chat_id: chatId, text: view.text, reply_markup: view.reply_markup, ...html });
}

// ---- entry points ----------------------------------------------------------------------------
/** /admin in a chat. Answers with the panel, or explains why not. */
export async function handleAdminCommand(env: Env, message: any, lang: Lang): Promise<void> {
    const a = A[lang];
    const chatId = message.chat.id;
    const userId = message.from?.id ?? chatId;

    if (message.chat.type !== "private") {
        await tg(env, "sendMessage", { chat_id: chatId, text: a.privateOnly });
        return;
    }
    if (adminIds(env).size === 0) {
        await tg(env, "sendMessage", { chat_id: chatId, text: a.notConfigured(userId), ...html });
        return;
    }
    if (!isAdmin(env, userId)) {
        await tg(env, "sendMessage", { chat_id: chatId, text: a.denied(userId), ...html });
        return;
    }
    await send(env, chatId, await panelView(env, lang));
}

interface AddResult { ok: boolean; text: string }

/** Validates a token and, if it is good, stores it as a helper bot. */
async function addHelper(env: Env, rawToken: string, lang: Lang): Promise<AddResult> {
    const a = A[lang];
    const fail = (text: string): AddResult => ({ ok: false, text });
    const token = rawToken.trim();
    if (!TOKEN_RE.test(token)) return fail(a.tokenInvalid);
    if (token === env.BOT_TOKEN || botKey(token) === botKey(env.BOT_TOKEN)) return fail(a.tokenIsMain);

    const helpers = await getHelpers(env);
    const dup = helpers.find(h => h.id === Number(botKey(token)));
    if (dup) return fail(a.tokenDup(dup.username));

    const me = await tg(env, "getMe", {}, token);
    if (!me.ok) return fail(a.tokenRejected(String(me.description ?? "unknown error")));
    const bot = { id: me.result.id as number, username: String(me.result.username) };

    if (!env.BIN_CHANNEL) return fail(a.noBin);
    const m = await tg(env, "getChatMember", { chat_id: env.BIN_CHANNEL, user_id: bot.id });
    if (!m.ok || !["administrator", "creator"].includes(m.result?.status)) return fail(a.notAdmin(bot.username));

    await saveHelpers(env, [...helpers, { ...bot, token } as HelperBot]);
    await clearCooldown(env, String(bot.id));
    return { ok: true, text: a.added(bot.username, bot.id) };
}

/**
 * A private message from an admin while the panel waits for a token (or "/addbot <token>").
 * The message is deleted as soon as it has been read, whatever the result, so tokens do not stay in the chat.
 */
export async function handleAdminToken(env: Env, message: any, lang: Lang, rawToken: string): Promise<void> {
    const a = A[lang];
    const chatId = message.chat.id;
    const userId = message.from?.id ?? chatId;

    if (/^\/cancel\b/i.test(rawToken)) {
        await env.SESSIONS.delete(stateKey(userId));
        await send(env, chatId, { text: a.cancelled, reply_markup: (await panelView(env, lang)).reply_markup });
        return;
    }

    const looksLikeToken = TOKEN_RE.test(rawToken.trim());
    const result = await addHelper(env, rawToken, lang);
    if (looksLikeToken) await tg(env, "deleteMessage", { chat_id: chatId, message_id: message.message_id });

    if (result.ok) await env.SESSIONS.delete(stateKey(userId));
    await send(env, chatId, result.ok
        ? { text: result.text, reply_markup: (await panelView(env, lang)).reply_markup }
        : { text: result.text, reply_markup: { inline_keyboard: [[{ text: a.btnCancel, callback_data: "adm:cancel" }]] } });
}

/** Presses on the panel buttons (callback_data starting with "adm:"). */
export async function handleAdminCallback(env: Env, cq: any, lang: Lang): Promise<void> {
    const a = A[lang];
    const userId = cq.from?.id;
    if (!isAdmin(env, userId)) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: a.deniedAlert, show_alert: true });
        return;
    }

    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const data = String(cq.data ?? "");
    const ack = (text?: string) => tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) });

    if (data === "adm:menu" || data === "adm:cancel") {
        if (data === "adm:cancel") await env.SESSIONS.delete(stateKey(userId));
        await ack(data === "adm:cancel" ? a.cancelled : undefined);
        await edit(env, chatId, messageId, await panelView(env, lang));
    } else if (data === "adm:add") {
        await env.SESSIONS.put(stateKey(userId), "token", { expirationTtl: 600 });
        await ack();
        await edit(env, chatId, messageId, {
            text: a.askToken,
            reply_markup: { inline_keyboard: [[{ text: a.btnCancel, callback_data: "adm:cancel" }]] },
        });
    } else if (data === "adm:list") {
        await ack();
        await edit(env, chatId, messageId, await listView(env, lang));
    } else if (data === "adm:check") {
        await ack();
        await edit(env, chatId, messageId, await checkView(env, lang));
    } else if (data === "adm:mode") {
        await setMode(env, (await getMode(env)) === "spread" ? "fallback" : "spread");
        await ack();
        await edit(env, chatId, messageId, await panelView(env, lang));
    } else if (/^adm:rm:\d+$/.test(data)) {
        const id = Number(data.slice("adm:rm:".length));
        const helpers = await getHelpers(env);
        const gone = helpers.find(h => h.id === id);
        if (gone) {
            await saveHelpers(env, helpers.filter(h => h.id !== id));
            await env.SESSIONS.delete(sessionKey(gone.token));
            await clearCooldown(env, String(id));
        }
        await ack(gone ? a.removed(gone.username) : undefined);
        await edit(env, chatId, messageId, await listView(env, lang));
    } else {
        await ack();
    }
}

