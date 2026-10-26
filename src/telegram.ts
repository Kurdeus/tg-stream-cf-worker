/**
 * Minimal Bot API caller. Never throws: a network failure comes back as { ok: false, description }.
 * Pass `token` to call the API as another bot (for example a helper bot), otherwise the main bot is used.
 */
export async function tg(env: { BOT_TOKEN: string }, method: string, payload?: unknown, token?: string): Promise<any> {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token ?? env.BOT_TOKEN}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload ?? {}),
        });
        return await res.json();
    } catch (e: any) {
        return { ok: false, description: `network error: ${e?.message ?? e}` };
    }
}
