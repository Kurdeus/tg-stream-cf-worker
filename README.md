<div align="center">
  <h1>🍿 TG Stream Bot</h1>
  <p><b>A Professional-Grade Telegram Proxy & Streaming Engine for Cloudflare Workers</b></p>

  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflareworkers&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MTProto-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="MTProto" />
</div>

---

## 🚀 Overview

**TG Stream Bot** is a high-performance Telegram file streaming engine designed to run on the **Cloudflare Edge**. By leveraging the power of **MTProto** and **WebAssembly (WASM)**, it allows users to stream or download Telegram files up to **4GB** with maximum efficiency and native speed.

### ✨ Key Features
- 💎 **High-Speed MTProto**: Powered by GramJS for low-latency data fetching.
- 🎬 **4GB Support**: Seamlessly handles documents, videos, and audio of any size.
- 🧱 **Range-Resilient**: Integrated support for `Range` requests ensures downloads never fail and can be resumed.
- 🛡️ **Privacy Shield**: Operates as a transparent proxy, keeping your bot token secure.
- 📦 **Automated Binning**: Automatically mirrors files to a private storage channel for persistence.

---

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Kurdeus/tg-stream-cf-worker)

> If you forked this repo, replace `Kurdeus/tg-stream-cloudflare` in the button link with your own `username/repo`. The repo must be **public**.

## 🚀 One-click deploy

1. Create a **private Telegram channel**, add your bot to it as **Admin**, and note the channel id (looks like `-100123456789`).
2. Click the **Deploy to Cloudflare** button above and log in.
3. In the form, paste the four values: `API_ID`, `API_HASH` (from https://my.telegram.org), `BOT_TOKEN` (from @BotFather) and `BIN_CHANNEL`.
   The KV namespaces and the Durable Object are created for you.
4. When the deploy finishes, **open your worker address once** (`https://<name>.<account>.workers.dev/`).
   That registers the Telegram webhook automatically. Open `/setup` to see a health report.
5. Send `/start` to your bot.

## ⚡ Alternative: terminal setup

```bash
npm install
npm run setup
```

The setup script logs in to Cloudflare, creates both KV namespaces, deploys the Worker, uploads the secrets
(`API_ID`, `API_HASH`, `BOT_TOKEN`, `BIN_CHANNEL`) and **registers the Telegram webhook**.

> Why the bot looked "active" but never answered: the original code never called Telegram's `setWebhook`,
> so Telegram had nowhere to send messages. The Worker now registers it automatically (on first visit to `/`
> and on every `/setup`). Open `https://YOUR-WORKER.workers.dev/setup` any time to see a health report
> (bot name, webhook state, last Telegram error, bot's role in the bin channel).

**Requirements:** the bot must be an **admin** of the private `BIN_CHANNEL` (id looks like `-100123456789`).
`WORKER_URL` is now optional (the Worker uses its own address).

---

## ⚙️ Manual Configuration (optional)

> [!IMPORTANT]
> To ensure stability on the Cloudflare Free Tier, this bot is optimized for high-frequency yielding to prevent execution timeouts.

### 1. Cloudflare KV Namespaces
Create two KV namespaces in your Cloudflare dashboard and link them in your `wrangler.toml`:
- `SESSIONS`: 🔒 Stores encrypted MTProto session data.
- `FILE_MAP`: 🗺️ Stores high-speed file-to-message mapping.

### 2. Environment Variables & Secrets
Supply the following secrets using `npx wrangler secret put <NAME>`:

| Variable | Description |
| :--- | :--- |
| `API_ID` | Your Telegram API ID from [my.telegram.org](https://my.telegram.org). |
| `API_HASH` | Your Telegram API Hash from [my.telegram.org](https://my.telegram.org). |
| `BOT_TOKEN` | Your Telegram Bot Token from [@BotFather](https://t.me/BotFather). |
| `BIN_CHANNEL` | The ID of your private storage channel (e.g., `-100123456789`). |
| `WORKER_URL` | The public endpoint of your worker (e.g., `https://stream.yourname.workers.dev`). |

---

## �️ Installation & Deployment

1. **Clone & Install**:
   ```bash
   npm install
   ```

2. **Wrangler Integration**:
   Update your IDs in `wrangler.toml`.

3. **Production Deployment**:
   ```bash
   npx wrangler deploy
   ```

---

## 📽️ Usage Instructions

1.  **Start Interaction**: Invoke `/start` in your Telegram Bot.
2.  **Upload Media**: Send any file (Video/Audio/Document) to the bot.
3.  **Instant Streaming**: The bot will return a **Direct Download Link**.
4.  **Playback**: Paste the link into browser, VLC, or power-users can use 1DM+/IDM for accelerated downloads.

---

<div align="center">
  <sub>Built with ❤️ by the community. Optimized for Cloudflare Edge.</sub>
</div>
