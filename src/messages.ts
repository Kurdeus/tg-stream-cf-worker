// All text the bot sends to people lives here, so it is easy to edit or translate.
// Messages use Telegram's HTML mode: only <b>, <i>, <code> and <a href> are used.

export const REPO_URL = "https://github.com/Kurdeus/tg-stream-cf-worker";
export const ORIGINAL_URL = "https://github.com/Vickydmt/tg-stream-cloudflare";

export const BOT_COMMANDS = [
    { command: "start", description: "شروع و معرفی ربات" },
    { command: "help", description: "راهنمای استفاده" },
    { command: "info", description: "درباره‌ی پروژه و سورس" },
];

export const START_TEXT = `سلام! 👋

من فایل‌هایی که برام بفرستی رو به <b>لینک مستقیم دانلود</b> تبدیل می‌کنم.

<b>طرز کار:</b>
۱. یک فایل برام بفرست (سند، ویدیو، آهنگ، صدا و ...).
۲. چند ثانیه بعد یک لینک مستقیم می‌گیری.
۳. لینک رو توی مرورگر یا مدیر دانلود («ADM»، «1DM»، «IDM») باز کن. اگه دانلود قطع شد، از همون‌جا ادامه پیدا می‌کنه.

برای دیدن راهنمای کامل /help رو بزن.`;

export const HELP_TEXT = `<b>راهنمای استفاده</b>

<b>فایل‌های قابل قبول:</b> سند، ویدیو، فایل صوتی، «voice»، «video note» و «animation».

<b>نکته‌ها:</b>
• برای فایل‌های حجیم از یک مدیر دانلود استفاده کن، چون دانلود قابل ادامه‌ست.
• اگه لینکی باز نشد، همون فایل رو دوباره برای ربات بفرست تا لینک تازه بسازه.
• لینک رو برای هر کسی بفرستی می‌تونه فایل رو دانلود کنه، پس با دقت پخشش کن.

<b>دستورها:</b>
/start معرفی ربات
/help همین راهنما
/info درباره‌ی پروژه و سورس`;

export const INFO_TEXT = `<b>درباره‌ی پروژه</b>

این ربات روی «Cloudflare Workers» اجرا می‌شه و فایل‌ها رو با «MTProto» (کتابخونه‌ی «GramJS») از تلگرام می‌خونه و مستقیم به دانلودر می‌رسونه.

<b>سورس‌کد:</b>
<a href="${REPO_URL}">GitHub · Kurdeus/tg-stream-cf-worker</a>

<b>پروژه‌ی اصلی که این نسخه ازش شروع شد:</b>
<a href="${ORIGINAL_URL}">GitHub · Vickydmt/tg-stream-cloudflare</a>

اگه مشکلی دیدی یا پیشنهادی داری، توی «Issues» ریپو بنویس.`;

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
