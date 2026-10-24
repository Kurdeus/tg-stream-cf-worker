// Everything the bot says lives here, in every supported language.
// To add a language: add its code to `Lang`, add an entry to `T`, and add a button in `langKeyboard`.
// Messages use Telegram's HTML mode: only <b>, <i>, <code> and <a href> are used.

export const REPO_URL = "https://github.com/Kurdeus/tg-stream-cf-worker";
export const ORIGINAL_URL = "https://github.com/Vickydmt/tg-stream-cloudflare";

export type Lang = "fa" | "en";
export const LANGS: Lang[] = ["fa", "en"];

/** Telegram client language code -> bot language. Anything that is not Persian gets English. */
export function langFromCode(code?: string): Lang {
    return (code || "").toLowerCase().startsWith("fa") ? "fa" : "en";
}

export interface Strings {
    start: string;
    help: string;
    info: string;
    btnChangeLang: string;
    langSet: string;
    linkHeader: string;
    setupIncomplete: string;
    storeFailed: (reason: string) => string;
    commands: { command: string; description: string }[];
}

export const T: Record<Lang, Strings> = {
    fa: {
        start: `سلام! 👋

من فایل‌هایی که برام بفرستی رو به <b>لینک مستقیم دانلود</b> تبدیل می‌کنم.

<b>طرز کار:</b>
۱. یک فایل برام بفرست (سند، ویدیو، آهنگ، صدا و ...).
۲. چند ثانیه بعد یک لینک مستقیم می‌گیری.
۳. لینک رو توی مرورگر یا مدیر دانلود («ADM»، «1DM»، «IDM») باز کن. اگه دانلود قطع شد، از همون‌جا ادامه پیدا می‌کنه.

برای دیدن راهنمای کامل /help و برای تغییر زبان /language رو بزن.`,

        help: `<b>راهنمای استفاده</b>

<b>فایل‌های قابل قبول:</b> سند، ویدیو، فایل صوتی، «voice»، «video note» و «animation».

<b>نکته‌ها:</b>
• برای فایل‌های حجیم از یک مدیر دانلود استفاده کن، چون دانلود قابل ادامه‌ست.
• اگه لینکی باز نشد، همون فایل رو دوباره برای ربات بفرست تا لینک تازه بسازه.
• لینک رو برای هر کسی بفرستی می‌تونه فایل رو دانلود کنه، پس با دقت پخشش کن.

<b>دستورها:</b>
/start معرفی ربات
/help همین راهنما
/info درباره‌ی پروژه و سورس
/language تغییر زبان`,

        info: `<b>درباره‌ی پروژه</b>

این ربات روی «Cloudflare Workers» اجرا می‌شه و فایل‌ها رو با «MTProto» (کتابخونه‌ی «GramJS») از تلگرام می‌خونه و مستقیم به دانلودر می‌رسونه.

<b>سورس‌کد:</b>
<a href="${REPO_URL}">GitHub · Kurdeus/tg-stream-cf-worker</a>

<b>پروژه‌ی اصلی که این نسخه ازش شروع شد:</b>
<a href="${ORIGINAL_URL}">GitHub · Vickydmt/tg-stream-cloudflare</a>

اگه مشکلی دیدی یا پیشنهادی داری، توی «Issues» ریپو بنویس.`,

        btnChangeLang: "🌐 تغییر زبان",
        langSet: "زبان فارسی انتخاب شد ✅",
        linkHeader: "🔗 لینک مستقیم دانلود:",
        setupIncomplete: "راه‌اندازی سرور کامل نیست: مقدار «BIN_CHANNEL» تنظیم نشده.",
        storeFailed: (reason) =>
            `ذخیره‌ی فایل در «BIN_CHANNEL» ممکن نشد.\nپاسخ تلگرام: ${reason}\n\nمطمئن شو ربات «ادمین» اون کانال هست و مقدار «BIN_CHANNEL» درسته (مثلاً -100123456789).`,
        commands: [
            { command: "start", description: "شروع و معرفی ربات" },
            { command: "help", description: "راهنمای استفاده" },
            { command: "info", description: "درباره‌ی پروژه و سورس" },
            { command: "language", description: "تغییر زبان" },
        ],
    },

    en: {
        start: `Hi! 👋

Send me a file and I will turn it into a <b>direct download link</b>.

<b>How it works:</b>
1. Send me a file (document, video, audio, voice note and so on).
2. A few seconds later you get a direct link.
3. Open the link in a browser or a download manager (ADM, 1DM, IDM). If a download is interrupted, it resumes from where it stopped.

Send /help for the full guide and /language to change the language.`,

        help: `<b>How to use the bot</b>

<b>Accepted files:</b> documents, videos, audio files, voice notes, video notes and animations.

<b>Tips:</b>
• For large files, use a download manager, because downloads can be resumed.
• If a link stops working, send the same file to the bot again and it will make a fresh one.
• Anyone who has the link can download the file, so share it carefully.

<b>Commands:</b>
/start introduction
/help this guide
/info about the project and source code
/language change the language`,

        info: `<b>About this project</b>

This bot runs on Cloudflare Workers. It reads files from Telegram over MTProto (the GramJS library) and streams them straight to the downloader.

<b>Source code:</b>
<a href="${REPO_URL}">GitHub · Kurdeus/tg-stream-cf-worker</a>

<b>The original project this version started from:</b>
<a href="${ORIGINAL_URL}">GitHub · Vickydmt/tg-stream-cloudflare</a>

If you find a problem or have an idea, open an issue in the repository.`,

        btnChangeLang: "🌐 Change language",
        langSet: "English selected ✅",
        linkHeader: "🔗 Direct download link:",
        setupIncomplete: "Server setup is incomplete: the BIN_CHANNEL secret is not set.",
        storeFailed: (reason) =>
            `Could not store the file in BIN_CHANNEL.\nTelegram says: ${reason}\n\nMake sure the bot is an ADMIN of that channel and BIN_CHANNEL is the correct id (for example -100123456789).`,
        commands: [
            { command: "start", description: "Start and introduction" },
            { command: "help", description: "How to use the bot" },
            { command: "info", description: "About and source code" },
            { command: "language", description: "Change language" },
        ],
    },
};

/** Shown to people who have not picked a language yet, so it is written in both. */
export const PICK_LANGUAGE_TEXT = `🌐 زبان خود را انتخاب کنید
Choose your language`;

export function langKeyboard() {
    return {
        inline_keyboard: [[
            { text: "🇮🇷 فارسی", callback_data: "lang:fa" },
            { text: "🇬🇧 English", callback_data: "lang:en" },
        ]],
    };
}

/** The small "change language" button under the welcome message. */
export function changeLangKeyboard(lang: Lang) {
    return { inline_keyboard: [[{ text: T[lang].btnChangeLang, callback_data: "lang:menu" }]] };
}

export function humanSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
