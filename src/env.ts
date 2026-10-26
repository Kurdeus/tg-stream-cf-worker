export interface Env {
    SESSIONS: KVNamespace;
    FILE_MAP?: KVNamespace; // optional: old deployments keep it, new ones use SESSIONS for everything
    API_ID: string;
    API_HASH: string;
    BOT_TOKEN: string;
    WORKER_URL?: string;
    BIN_CHANNEL?: string;
    ADMIN_IDS?: string; // comma separated Telegram user ids allowed to open /admin
    STREAMER: DurableObjectNamespace;
}
