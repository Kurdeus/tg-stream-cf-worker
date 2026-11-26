export interface Env {
    SESSIONS: KVNamespace;
    FILE_MAP?: KVNamespace; // optional: old deployments keep it, new ones use SESSIONS for everything
    API_ID: string;
    API_HASH: string;
    BOT_TOKEN: string;
    WORKER_URL?: string;
    GIST_URL?: string;            // raw URL of a .dev.vars style file holding all the settings below
    MIRROR_BOT_TOKENS?: string[]; // filled from MIRROR_BOT_TOKEN_1..n in the gist (helper bots)
    BIN_CHANNEL?: string;
    ADMIN_IDS?: string; // comma separated Telegram user ids allowed to open /admin
    STREAMER: DurableObjectNamespace;
    GUARD: DurableObjectNamespace;
}
