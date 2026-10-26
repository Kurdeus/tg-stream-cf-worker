// Texts of the /admin panel, in every language. Telegram HTML mode (<b>, <code>).
import type { Lang } from "./messages";
import type { Mode } from "./bots";

export interface AdminStrings {
    denied: (userId: number | string) => string;
    notConfigured: (userId: number | string) => string;
    privateOnly: string;
    panel: (main: string, total: number, cooling: number, mode: Mode) => string;
    btnAdd: string;
    btnList: string;
    btnCheck: string;
    btnMode: (mode: Mode) => string;
    btnBack: string;
    btnCancel: string;
    askToken: string;
    tokenInvalid: string;
    tokenIsMain: string;
    tokenDup: (u: string) => string;
    tokenRejected: (d: string) => string;
    notAdmin: (u: string) => string;
    noBin: string;
    added: (u: string, id: number) => string;
    listEmpty: string;
    listHeader: string;
    ready: string;
    cooling: (seconds: number) => string;
    removed: (u: string) => string;
    checkHeader: string;
    checkOk: (label: string) => string;
    checkFail: (label: string, reason: string) => string;
    cancelled: string;
    deniedAlert: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const A: Record<Lang, AdminStrings> = {
    fa: {
        denied: (id) => `⛔ دسترسی نداری.\nشناسه‌ی تلگرام تو: <code>${id}</code>\nاگه صاحب ربات هستی، این شناسه رو به «ADMIN_IDS» اضافه کن.`,
        notConfigured: (id) => `پنل مدیریت هنوز تنظیم نشده.\nشناسه‌ی تلگرام تو: <code>${id}</code>\nاون رو توی «secret» با نام «ADMIN_IDS» ذخیره کن و دوباره /admin رو بزن.`,
        privateOnly: "پنل مدیریت فقط توی چت خصوصی با ربات کار می‌کنه.",
        panel: (main, total, cooling, mode) =>
            `🛠 <b>پنل مدیریت</b>\n\nربات اصلی: @${main}\nربات‌های کمکی: ${total}${cooling ? ` (${cooling} در حال استراحت)` : ""}\nحالت: ${mode === "spread" ? "پخش بار بین همه‌ی ربات‌ها" : "فقط جایگزین (وقتی خطا شد)"}\n\nهر ربات کمکی باید «ادمین» کانال ذخیره‌سازی باشه.`,
        btnAdd: "➕ افزودن ربات",
        btnList: "📋 ربات‌های کمکی",
        btnCheck: "🔄 بررسی دسترسی",
        btnMode: (m) => (m === "spread" ? "⚖️ حالت: پخش بار" : "⚖️ حالت: جایگزین"),
        btnBack: "⬅️ بازگشت",
        btnCancel: "✖️ لغو",
        askToken: "توکن ربات جدید رو از «@BotFather» بفرست.\nبعد از خوندن، پیامت رو پاک می‌کنم تا توکن توی چت نمونه.\nبرای انصراف /cancel رو بزن.",
        tokenInvalid: "این شبیه توکن ربات نیست. شکل درستش مثل «123456789:AAH...» هست. دوباره بفرست یا /cancel بزن.",
        tokenIsMain: "این توکن همون ربات اصلیه. یک ربات دیگه بساز و توکنش رو بفرست.",
        tokenDup: (u) => `@${u} از قبل توی لیست هست.`,
        tokenRejected: (d) => `تلگرام این توکن رو قبول نکرد: ${esc(d)}`,
        notAdmin: (u) => `@${u} هنوز «ادمین» کانال ذخیره‌سازی نیست. اول اون رو به‌عنوان ادمین به کانال اضافه کن و بعد دوباره توکن رو بفرست.`,
        noBin: "«BIN_CHANNEL» تنظیم نشده.",
        added: (u, id) => `✅ @${u} (شناسه: <code>${id}</code>) اضافه شد. اگه ربات اصلی خطا بده یا محدود بشه، این ربات جایگزینش می‌شه.`,
        listEmpty: "هنوز ربات کمکی اضافه نشده.",
        listHeader: "📋 <b>ربات‌های کمکی</b>",
        ready: "آماده",
        cooling: (s) => `استراحت ${s} ثانیه`,
        removed: (u) => `@${u} حذف شد.`,
        checkHeader: "🔄 <b>بررسی دسترسی به کانال ذخیره‌سازی</b>",
        checkOk: (l) => `✅ ${l}: ادمین کانال`,
        checkFail: (l, r) => `❌ ${l}: ${esc(r)}`,
        cancelled: "لغو شد.",
        deniedAlert: "⛔ دسترسی نداری",
    },
    en: {
        denied: (id) => `⛔ Access denied.\nYour Telegram id: <code>${id}</code>\nIf you own this bot, add that id to ADMIN_IDS.`,
        notConfigured: (id) => `The admin panel is not set up yet.\nYour Telegram id: <code>${id}</code>\nSave it in the secret named ADMIN_IDS, then send /admin again.`,
        privateOnly: "The admin panel only works in a private chat with the bot.",
        panel: (main, total, cooling, mode) =>
            `🛠 <b>Admin panel</b>\n\nMain bot: @${main}\nHelper bots: ${total}${cooling ? ` (${cooling} cooling down)` : ""}\nMode: ${mode === "spread" ? "spread the load over all bots" : "fallback only (when something fails)"}\n\nEvery helper bot must be an admin of the storage channel.`,
        btnAdd: "➕ Add bot",
        btnList: "📋 Helper bots",
        btnCheck: "🔄 Check access",
        btnMode: (m) => (m === "spread" ? "⚖️ Mode: spread" : "⚖️ Mode: fallback"),
        btnBack: "⬅️ Back",
        btnCancel: "✖️ Cancel",
        askToken: "Send the new bot's token from @BotFather.\nI delete your message after reading it so the token does not stay in the chat.\nSend /cancel to abort.",
        tokenInvalid: "That does not look like a bot token. A real one looks like 123456789:AAH... Send it again or /cancel.",
        tokenIsMain: "That is the main bot's own token. Create another bot and send its token.",
        tokenDup: (u) => `@${u} is already in the list.`,
        tokenRejected: (d) => `Telegram rejected this token: ${esc(d)}`,
        notAdmin: (u) => `@${u} is not an admin of the storage channel yet. Add it to the channel as an administrator first, then send the token again.`,
        noBin: "BIN_CHANNEL is not set.",
        added: (u, id) => `✅ @${u} (id: <code>${id}</code>) added. If the main bot fails or gets rate limited, this bot takes over.`,
        listEmpty: "No helper bots yet.",
        listHeader: "📋 <b>Helper bots</b>",
        ready: "ready",
        cooling: (s) => `cooling down ${s}s`,
        removed: (u) => `@${u} removed.`,
        checkHeader: "🔄 <b>Access to the storage channel</b>",
        checkOk: (l) => `✅ ${l}: channel admin`,
        checkFail: (l, r) => `❌ ${l}: ${esc(r)}`,
        cancelled: "Cancelled.",
        deniedAlert: "⛔ Access denied",
    },
};
