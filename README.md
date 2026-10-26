<div align="center">

# tg-stream-cf-worker

**Turn any file you send to a Telegram bot into a direct, resumable download link, served from a Cloudflare Worker.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Kurdeus/tg-stream-cf-worker)

[English](#english) · [فارسی](#persian)

</div>

---

<a id="english"></a>

## What this is

You send a file to your Telegram bot. A few seconds later the bot answers with a normal `https://` link. That link works in a browser, in VLC, or in a download manager such as ADM, 1DM or IDM, even for files that are hundreds of megabytes, and an interrupted download picks up where it stopped.

```text
you ──file──▶ bot ──copy──▶ private channel (storage)
                                   │
 browser / ADM ◀── stream ◀── Cloudflare Worker ◀── MTProto
```

The bot does not keep files anywhere except a private Telegram channel that you own. The Worker reads them back from that channel on demand and passes the bytes straight through to the downloader.

## Before you start

You need four values, plus an optional fifth. Collect them first and the setup takes a couple of minutes.

| Name | Where it comes from |
|---|---|
| `API_ID` and `API_HASH` | Log in at [my.telegram.org](https://my.telegram.org), open *API development tools* and create an app. |
| `BOT_TOKEN` | Create a bot with [@BotFather](https://t.me/BotFather) and copy the token it gives you. |
| `ADMIN_IDS` | Optional. Your numeric Telegram user id (ask [@userinfobot](https://t.me/userinfobot)); several ids can be separated by commas. Without it the `/admin` panel stays off. |
| `BIN_CHANNEL` | Create a **private** channel, add your bot as an **administrator**, then get the channel id (it looks like `-100123456789`). |

## Deploy

### Option 1: the button (no terminal)

1. Click **Deploy to Cloudflare** at the top of this page and sign in.
2. Paste the four values into the form. The KV namespace and the Durable Object are created for you.
3. When the deploy is finished, open your worker address once, for example `https://tg-stream.your-account.workers.dev/`. This registers the Telegram webhook.
4. Message your bot and send `/start`.

> The button only works while this repository is **public**.

### Option 2: one command from a terminal

```bash
npm install
npm run setup
```

The script logs you in to Cloudflare, creates the KV namespace, deploys, uploads your secrets and registers the webhook. It also checks that your bot really is an admin of the storage channel before it deploys anything.

### Option 3: by hand

```bash
npm install
npx wrangler deploy
npx wrangler secret put API_ID
npx wrangler secret put API_HASH
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BIN_CHANNEL
npx wrangler secret put ADMIN_IDS   # optional
```

Then visit the worker address once. If wrangler asks about the KV namespace, let it create it.

## Check that it works

Open `/setup` on your worker address, for example [https://tg-stream.kurdeus.workers.dev/setup](https://tg-stream.kurdeus.workers.dev/setup) (that is the author's own deployment, yours will have a different name). Opening it again and again is safe: it only re-registers the webhook when Telegram is not pointing at this worker. You get a small JSON report:

| Field | What it tells you |
|---|---|
| `ok` | `true` when everything below is fine. |
| `api_id`, `api_hash` | Whether the two Telegram credentials look valid. |
| `missing_secrets` | Names of secrets you forgot to set. |
| `webhook_registered` | Whether Telegram knows where to send messages. |
| `last_error` | The last delivery error Telegram reported, if any. |
| `admins_configured`, `helper_bots` | How many admin ids and helper bots are set up. |
| `bin_channel` | The bot's role in the storage channel. It must say `administrator`. |
| `last_stream_error` | The most recent download failure, useful when a link breaks. |

## Using the bot

1. Send `/start`. The first time, the bot asks which language you want, Persian (فارسی) or English, and remembers your choice for next time.
2. Change the language whenever you like with `/language` or the button under the welcome message.
3. `/help` shows tips and `/info` links to the source code.
4. Send any document, video, audio file, voice note or animation.
5. Copy the link the bot sends back and open it anywhere.

## Helper bots (optional)

If the main bot hits a Telegram rate limit (`FLOOD_WAIT`) or fails, helper bots take over. A download that is already running continues on the next bot from the exact byte where it stopped, so the downloader does not notice.

1. Create one or more extra bots with [@BotFather](https://t.me/BotFather).
2. Add each of them to the storage channel (`BIN_CHANNEL`) as an **administrator**.
3. Put your own numeric Telegram id into the `ADMIN_IDS` secret.
4. In a private chat with the main bot send `/admin`, press **Add bot** and send the new bot's token. The bot deletes your message right after reading it.

The panel can add bots, list them (with a remove button for each), check that every bot still has access to the storage channel, and switch between two modes:

- **Fallback** (default): the main bot is always tried first, helpers only step in when something fails.
- **Spread**: every download starts on a random ready bot, so parallel connections are shared between accounts.

`/addbot <token>` does the same as the button. A bot that was rate limited is skipped for the length of its wait, one with a revoked token or no channel access for ten minutes.

Good to know:

- Helper bots only read files from the storage channel. People still talk to the main bot.
- Their tokens are stored in your own Cloudflare KV, so keep your Cloudflare account safe.
- Extra bots do not raise Cloudflare's own limits.
- Check Telegram's terms before relying on several bots to get around its limits. That decision is yours.

## If something goes wrong

| What you see | Most likely reason |
|---|---|
| The bot answers `/start` but ignores files | The storage channel is wrong or the bot is not an admin there. The bot tells you Telegram's exact complaint. |
| The bot says nothing at all | The webhook is not registered. Open `/setup`. |
| `Worker exceeded CPU time limit` | A plain Worker request has a very small CPU budget. Make sure the `STREAMER` Durable Object block from `wrangler.toml` is present in your deployed version. |
| A download stops and resumes again and again | Check the `[dl ...]` lines in the worker's live logs: `CLIENT CLOSED` means the downloader or network dropped, `ERROR` means Telegram did. |
| `Cannot provision a KV Namespace ... already exists` | A KV namespace with that name is already in your account, usually left over from an earlier attempt. Delete it in the dashboard (Storage & Databases, then KV), or type a different name in the Deploy form. |
| `The value of "value" is out of range` or `API_ID is invalid` | The `API_ID` secret is wrong. The number is too big for Telegram's 32-bit field, so it is probably your bot's id or your own user id. Use the App api_id from [my.telegram.org](https://my.telegram.org), set the secret again (Settings, then Variables and Secrets) and open `/setup`: it checks `API_ID` and `API_HASH` for you. |
| The language buttons do nothing | Telegram is not delivering button presses to the worker. Open `/setup`: it re-registers the webhook with button support. |
| `/admin` says the panel is not set up | The `ADMIN_IDS` secret is empty. The message shows your id, put it there. |
| Adding a bot says it is not an admin | Add that bot to `BIN_CHANNEL` as an administrator first, then send the token again. |
| `Link Expired` | The file was never stored, or the key was removed. Send the file to the bot again. |

## How it is built

- `src/index.ts` receives Telegram updates, registers the webhook, copies each file into the storage channel and builds the link.
- `src/messages.ts` holds every text the bot sends, in Persian and English. Edit it to change the wording, or add an entry to `T` (and a button in `langKeyboard`) to support another language. Each person's choice is stored in KV under `lang:<user id>`.
- `src/bots.ts` keeps the list of helper bots, their cooldowns, the mode and the error classification. `src/admin.ts` and `src/admin-messages.ts` are the `/admin` panel.
- `src/streamer.ts` opens its own MTProto connection for every download request, reads the stored message, and streams it with support for `Range` requests. If Telegram stalls, it reconnects and continues from the exact byte.
- The streaming itself runs inside a SQLite-backed Durable Object, so the heavy decryption does not count against the small CPU budget of a normal Worker request.

## Limits worth knowing

- `/setup` is open to anyone who knows your worker address. It never prints your token and changes nothing when everything is already set up, but you may still want to remove the route once everything works.
- Free Cloudflare plans have daily request quotas. A busy public bot can use them up.
- This project depends on a third-party MTProto library and on Cloudflare's current limits, both of which change over time.

## License

Released under the [MIT License](LICENSE). This version started from [Vickydmt/tg-stream-cloudflare](https://github.com/Vickydmt/tg-stream-cloudflare), which does not state a license, so the MIT License covers the work added in this repository and cannot grant rights to the original author's code. Dependencies keep their own licenses.

## Credits

Thank you to **[Vickydmt](https://github.com/Vickydmt)** for the original project this worker grew out of, [Vickydmt/tg-stream-cloudflare](https://github.com/Vickydmt/tg-stream-cloudflare). It was the starting point for this version. Thanks also to the authors of GramJS.

---

<a id="persian"></a>

<div dir="rtl">

# ‏راهنمای فارسی

‏توضیح کوتاه: ربات تلگرام که هر فایل را به لینک مستقیم و قابل‌ادامه تبدیل می‌کند و روی «⁦Cloudflare Workers⁩» اجرا می‌شود.

## ‏این پروژه چیست؟

‏یک فایل برای رباتتان در تلگرام می‌فرستید و چند ثانیه بعد ربات یک لینک معمولی با «⁦https⁩» برمی‌گرداند. این لینک را می‌توانید در مرورگر، «⁦VLC⁩» یا مدیر دانلودی مثل «⁦ADM⁩»، «⁦1DM⁩» و «⁦IDM⁩» باز کنید. حتی برای فایل‌های چند صد مگابایتی هم کار می‌کند و اگر دانلود وسط راه قطع شود، از همان جا ادامه پیدا می‌کند.

```text
you ──file──▶ bot ──copy──▶ private channel (storage)
                                   │
 browser / ADM ◀── stream ◀── Cloudflare Worker ◀── MTProto
```

‏فایل‌ها جایی جز یک کانال خصوصی تلگرام که خودتان صاحبش هستید نگهداری نمی‌شوند. ورکر هر وقت لازم باشد فایل را از همان کانال می‌خواند و بایت‌ها را مستقیم به دانلودر می‌رساند.

## ‏پیش از شروع

‏چهار مقدار لازم دارید و یک مقدار پنجم اختیاری است. اگر اول همه را آماده کنید، راه‌اندازی چند دقیقه بیشتر طول نمی‌کشد.

| ‏نام | ‏از کجا بگیریم |
|---|---|
| ‏⁦`API_ID`⁩ و ⁦`API_HASH`⁩ | ‏در [⁦my.telegram.org⁩](https://my.telegram.org) وارد شوید، بخش «⁦API development tools⁩» را باز کنید و یک «⁦app⁩» بسازید. |
| ⁦`BOT_TOKEN`⁩ | ‏با [@⁦BotFather⁩](https://t.me/BotFather) یک ربات بسازید و توکنش را کپی کنید. |
| ⁦`ADMIN_IDS`⁩ | ‏اختیاری. شناسه‌ی عددی تلگرام شما (از [@⁦userinfobot⁩](https://t.me/userinfobot))؛ چند شناسه را با کاما جدا کنید. بدون آن پنل ⁦`/admin`⁩ خاموش می‌ماند. |
| ⁦`BIN_CHANNEL`⁩ | ‏یک کانال **خصوصی** بسازید، ربات را به‌عنوان **ادمین** به آن اضافه کنید و شناسه‌ی کانال را بردارید. شناسه چیزی شبیه ⁦`-100123456789`⁩ است. |

## ‏راه‌اندازی

### ‏روش اول: دکمه (بدون ترمینال)

1. ‏روی دکمه‌ی «⁦Deploy to Cloudflare⁩» بالای همین صفحه بزنید و وارد حساب شوید.
2. ‏چهار مقدار بالا را در فرم وارد کنید. «⁦KV⁩» و «⁦Durable Object⁩» خودکار ساخته می‌شوند.
3. ‏بعد از پایان «⁦deploy⁩»، آدرس ورکر را یک بار باز کنید، مثلاً ⁦`https://tg-stream.your-account.workers.dev/`⁩. با همین کار «⁦webhook⁩» تلگرام ثبت می‌شود.
4. ‏به ربات پیام بدهید و ⁦`/start`⁩ را بفرستید.

> ‏دکمه فقط وقتی کار می‌کند که این ریپو **عمومی (⁦public⁩)** باشد.

### ‏روش دوم: یک دستور در ترمینال

```bash
npm install
npm run setup
```

‏این اسکریپت شما را وارد «⁦Cloudflare⁩» می‌کند، «⁦KV⁩» را می‌سازد، «⁦deploy⁩» را انجام می‌دهد، «⁦secret⁩»ها را می‌فرستد و «⁦webhook⁩» را ثبت می‌کند. پیش از «⁦deploy⁩» هم چک می‌کند که ربات واقعاً ادمین کانال ذخیره‌سازی هست.

### ‏روش سوم: دستی

```bash
npm install
npx wrangler deploy
npx wrangler secret put API_ID
npx wrangler secret put API_HASH
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BIN_CHANNEL
npx wrangler secret put ADMIN_IDS   # optional
```

‏بعد از آن هم یک بار آدرس ورکر را باز کنید. اگر «⁦wrangler⁩» درباره‌ی «⁦KV⁩» سؤال کرد، بگذارید خودش آن را بسازد.

## ‏مطمئن شوید که کار می‌کند

‏آدرس ⁦`/setup`⁩ ورکر را باز کنید، مثلاً [⁦https://tg-stream.kurdeus.workers.dev/setup⁩](https://tg-stream.kurdeus.workers.dev/setup) (این ورکر خود نویسنده است و اسم ورکر شما فرق می‌کند). باز کردن مکرر این آدرس خطری ندارد: فقط وقتی تلگرام به این ورکر اشاره نکند «⁦webhook⁩» را دوباره ثبت می‌کند. یک گزارش کوتاه «⁦JSON⁩» می‌بینید:

| ‏فیلد | ‏معنی |
|---|---|
| ⁦`ok`⁩ | ‏وقتی همه‌چیز درست باشد ⁦`true`⁩ است. |
| ‏⁦`api_id`⁩ و ⁦`api_hash`⁩ | ‏اینکه دو مقدار اعتبارنامه‌ی تلگرام معتبر به نظر می‌رسند یا نه. |
| ⁦`missing_secrets`⁩ | ‏اسم «⁦secret⁩»هایی که فراموش کرده‌اید. |
| ⁦`webhook_registered`⁩ | ‏اینکه تلگرام می‌داند پیام‌ها را کجا بفرستد یا نه. |
| ⁦`last_error`⁩ | ‏آخرین خطای تحویل پیام که تلگرام گزارش کرده است. |
| ‏⁦`admins_configured`⁩ و ⁦`helper_bots`⁩ | ‏تعداد شناسه‌های ادمین و ربات‌های کمکی که تنظیم شده. |
| ⁦`bin_channel`⁩ | ‏نقش ربات در کانال ذخیره‌سازی. باید ⁦`administrator`⁩ باشد. |
| ⁦`last_stream_error`⁩ | ‏آخرین خطای دانلود. وقتی یک لینک خراب می‌شود به کار می‌آید. |

## ‏استفاده از ربات

1. ‏⁦`/start`⁩ را بفرستید. بار اول ربات می‌پرسد کدام زبان را می‌خواهید، فارسی یا انگلیسی (⁦English⁩)، و انتخابتان را برای دفعه‌های بعد یادش می‌ماند.
2. ‏هر وقت خواستید با ⁦`/language`⁩ یا دکمه‌ی زیر پیام خوش‌آمد زبان را عوض کنید.
3. ‏⁦`/help`⁩ راهنما و ⁦`/info`⁩ لینک سورس را نشان می‌دهد.
4. ‏هر سند، ویدیو، فایل صوتی، «⁦voice⁩» یا «⁦animation⁩» که بخواهید بفرستید.
5. ‏لینکی را که ربات برمی‌گرداند کپی کنید و هر جا خواستید باز کنید.

## ‏ربات‌های کمکی (اختیاری)

‏اگر ربات اصلی به محدودیت سرعت تلگرام («⁦FLOOD_WAIT⁩») بخورد یا خطا بدهد، ربات‌های کمکی کار را به دست می‌گیرند. دانلودی که در حال انجام است از همان بایتی که قطع شده روی ربات بعدی ادامه پیدا می‌کند و دانلودر متوجه نمی‌شود.

1. ‏با [@⁦BotFather⁩](https://t.me/BotFather) یک یا چند ربات دیگر بسازید.
2. ‏هر کدام را به‌عنوان **ادمین** به کانال ذخیره‌سازی (⁦`BIN_CHANNEL`⁩) اضافه کنید.
3. ‏شناسه‌ی عددی تلگرام خودتان را در «⁦secret⁩» با نام ⁦`ADMIN_IDS`⁩ بگذارید.
4. ‏توی چت خصوصی با ربات اصلی ⁦`/admin`⁩ را بفرستید، **افزودن ربات** را بزنید و توکن ربات جدید را بفرستید. ربات پیام شما را بعد از خواندن پاک می‌کند.

‏پنل می‌تواند ربات اضافه کند، فهرستشان را نشان بدهد (با دکمه‌ی حذف برای هر کدام)، بررسی کند که همه هنوز به کانال ذخیره‌سازی دسترسی دارند، و بین دو حالت جابه‌جا شود:

- ‏**جایگزین** (پیش‌فرض): همیشه اول ربات اصلی امتحان می‌شود و ربات‌های کمکی فقط وقتی چیزی خراب شد وارد می‌شوند.
- ‏**پخش بار:** هر دانلود از یک ربات آماده‌ی تصادفی شروع می‌شود، تا اتصال‌های هم‌زمان بین حساب‌ها پخش شوند.

‏⁦`/addbot <token>`⁩ همان کار دکمه را می‌کند. رباتی که به محدودیت سرعت خورده باشد به اندازه‌ی مدت انتظارش کنار گذاشته می‌شود، و رباتی که توکنش باطل شده یا دسترسی کانال را از دست داده ده دقیقه.

‏نکته‌ها:

- ‏ربات‌های کمکی فقط فایل را از کانال می‌خوانند و کاربرها همچنان با ربات اصلی حرف می‌زنند.
- ‏توکن‌هایشان در «⁦KV⁩» حساب کلادفلر خودتان ذخیره می‌شود، پس از حساب کلادفلرتان خوب مراقبت کنید.
- ‏ربات‌های بیشتر محدودیت‌های خود کلادفلر را بالا نمی‌برند.
- ‏قبل از تکیه بر چند ربات برای دور زدن محدودیت‌های تلگرام، قوانین تلگرام را بخوانید. این تصمیم با خودتان است.

## ‏اگر مشکلی پیش آمد

| ‏چه می‌بینید | ‏محتمل‌ترین دلیل |
|---|---|
| ‏ربات به ⁦`/start`⁩ جواب می‌دهد ولی فایل را نادیده می‌گیرد | ‏کانال ذخیره‌سازی اشتباه است یا ربات آنجا ادمین نیست. ربات خودش دلیل دقیق تلگرام را برایتان می‌نویسد. |
| ‏ربات هیچ جوابی نمی‌دهد | ‏«⁦webhook⁩» ثبت نشده. ⁦`/setup`⁩ را باز کنید. |
| ⁦`Worker exceeded CPU time limit`⁩ | ‏سهم ⁦CPU⁩ یک درخواست معمولی ورکر خیلی کم است. مطمئن شوید بلوک «⁦Durable Object⁩» با نام ⁦`STREAMER`⁩ از «⁦wrangler.toml⁩» در نسخه‌ی «⁦deploy⁩» شده‌ی شما هست. |
| ‏دانلود مدام قطع و وصل می‌شود | ‏خط‌های ⁦`[dl ...]`⁩ را در لاگ زنده‌ی ورکر نگاه کنید. ⁦`CLIENT CLOSED`⁩ یعنی دانلودر یا شبکه قطع کرده، و ⁦`ERROR`⁩ یعنی تلگرام. |
| ⁦`Cannot provision a KV Namespace ... already exists`⁩ | ‏یک «⁦KV⁩» با همین اسم از قبل توی حساب شما هست، معمولاً از تلاش قبلی باقی مانده. آن را از داشبورد پاک کنید (بخش «⁦Storage & Databases⁩» و بعد «⁦KV⁩») یا توی فرم «⁦Deploy⁩» اسم دیگری بنویسید. |
| ‏⁦`The value of "value" is out of range`⁩ یا ⁦`API_ID is invalid`⁩ | ‏«⁦secret⁩» با نام ⁦`API_ID`⁩ اشتباه است. این عدد برای فیلد ۳۲ بیتی تلگرام بزرگ‌تر است، پس احتمالاً شناسه‌ی خود ربات یا شناسه‌ی کاربری شماست. «⁦App api_id⁩» را از [⁦my.telegram.org⁩](https://my.telegram.org) بردارید، «⁦secret⁩» را دوباره تنظیم کنید (بخش «⁦Settings⁩» و بعد «⁦Variables and Secrets⁩») و ⁦`/setup`⁩ را باز کنید: ⁦`API_ID`⁩ و ⁦`API_HASH`⁩ را برایتان چک می‌کند. |
| ‏دکمه‌های زبان کار نمی‌کنند | ‏تلگرام فشرده شدن دکمه‌ها را به ورکر نمی‌رساند. ⁦`/setup`⁩ را باز کنید: «⁦webhook⁩» را با پشتیبانی از دکمه دوباره ثبت می‌کند. |
| ‏⁦`/admin`⁩ می‌گوید پنل تنظیم نشده | ‏«⁦secret⁩» با نام ⁦`ADMIN_IDS`⁩ خالی است. پیام ربات شناسه‌ی شما را نشان می‌دهد، همان را آنجا بگذارید. |
| ‏موقع افزودن ربات می‌گوید ادمین نیست | ‏اول آن ربات را به‌عنوان ادمین به ⁦`BIN_CHANNEL`⁩ اضافه کنید و بعد توکن را دوباره بفرستید. |
| ⁦`Link Expired`⁩ | ‏فایل هیچ‌وقت ذخیره نشده یا کلیدش پاک شده. فایل را دوباره برای ربات بفرستید. |

## ‏ساختار پروژه

- ‏⁦`src/index.ts`⁩ پیام‌های تلگرام را می‌گیرد، «⁦webhook⁩» را ثبت می‌کند، هر فایل را به کانال ذخیره‌سازی کپی می‌کند و لینک را می‌سازد.
- ‏⁦`src/messages.ts`⁩ همه‌ی متن‌هایی را که ربات می‌فرستد، به فارسی و انگلیسی، نگه می‌دارد. برای عوض کردن جمله‌ها همین فایل را ویرایش کنید. برای افزودن زبان تازه یک ورودی به ⁦`T`⁩ و یک دکمه در ⁦`langKeyboard`⁩ اضافه کنید. انتخاب هر کاربر در «⁦KV⁩» با کلید ⁦`lang:<user id>`⁩ ذخیره می‌شود.
- ‏⁦`src/bots.ts`⁩ فهرست ربات‌های کمکی، زمان استراحتشان، حالت کار و دسته‌بندی خطاها را نگه می‌دارد. ⁦`src/admin.ts`⁩ و ⁦`src/admin-messages.ts`⁩ پنل ⁦`/admin`⁩ هستند.
- ‏⁦`src/streamer.ts`⁩ برای هر درخواست دانلود یک اتصال «⁦MTProto⁩» جدا باز می‌کند، پیام ذخیره‌شده را می‌خواند و با پشتیبانی از «⁦Range⁩» پخش می‌کند. اگر تلگرام گیر کند، دوباره وصل می‌شود و از همان بایت ادامه می‌دهد.
- ‏خودِ پخش داخل یک «⁦Durable Object⁩» با ذخیره‌ساز «⁦SQLite⁩» اجرا می‌شود، تا رمزگشایی سنگین از سهم کوچک ⁦CPU⁩ یک درخواست معمولی ورکر کم نشود.

## ‏نکاتی که باید بدانید

- ‏آدرس ⁦`/setup`⁩ برای هر کسی که آدرس ورکرتان را بداند بازه. توکن را نشان نمی‌دهد و وقتی همه‌چیز راه افتاده باشد چیزی را تغییر نمی‌دهد، ولی بعد از راه افتادن همه‌چیز باز هم شاید بخواهید این مسیر را حذف کنید.
- ‏پلن رایگان «⁦Cloudflare⁩» سهمیه‌ی روزانه‌ی درخواست دارد و یک ربات عمومی پرمراجعه می‌تواند آن را تمام کند.
- ‏این پروژه به یک کتابخانه‌ی «⁦MTProto⁩» از یک نویسنده‌ی دیگر و به محدودیت‌های فعلی «⁦Cloudflare⁩» وابسته است و هر دو ممکن است عوض شوند.

## ‏مجوز

‏این پروژه با [مجوز ⁦MIT⁩](LICENSE) منتشر شده است. این نسخه از [⁦Vickydmt/tg-stream-cloudflare⁩](https://github.com/Vickydmt/tg-stream-cloudflare) شروع شد که مجوزی اعلام نکرده، پس مجوز ⁦MIT⁩ کارهایی را پوشش می‌دهد که در همین ریپو اضافه شده و نمی‌تواند حقی نسبت به کد نویسنده‌ی اصلی بدهد. کتابخانه‌های وابسته هم مجوز خودشان را دارند.

## ‏تشکر

‏از **[⁦Vickydmt⁩](https://github.com/Vickydmt)** ممنونم که پروژه‌ی اصلی، یعنی [⁦Vickydmt/tg-stream-cloudflare⁩](https://github.com/Vickydmt/tg-stream-cloudflare)، را ساخت و منتشر کرد. کار این نسخه از روی همان پروژه شروع شد. از نویسندگان «⁦GramJS⁩» هم سپاسگزارم.

</div>
