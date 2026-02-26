export const TRANSFER_CONFIG = {
    // ─── Parallel Connections ───────────────────────────────
    // Multiple PeerConnections to overcome per-PC SCTP cwnd limits
    // Each PC gets independent cwnd → linear throughput scaling
    // Max 4-5 PC = sweet spot (browser stability, throughput balance)
    PARALLEL_CONNECTIONS: 4,           // 4 PC = max pratico (stability tested)
    ENABLE_PARALLEL_MODE: true,        // Feature flag per rollback
    PARALLEL_SIZE_THRESHOLD_2: 50 * 1024 * 1024,    // 50MB  → 2 PC
    PARALLEL_SIZE_THRESHOLD_3: 150 * 1024 * 1024,   // 150MB → 3 PC
    PARALLEL_SIZE_THRESHOLD_4: 300 * 1024 * 1024,   // 300MB → 4 PC

    // ─── Channel Limits ─────────────────────────────────────
    MAX_CHANNELS_DEFAULT: 2,           // 2 channels per PC (3 PC × 2 = 6 total)
    MAX_CHANNELS_SAFARI: 2,            // Safari: 2 channels per PC

    // ─── Chunk Sizes (bytes) ────────────────────────────────
    // WebRTC DataChannel max message size (browser-specific):
    // - Chrome/Firefox: 256KB safe (some browsers support more but not reliable)
    // - Safari: 64KB recommended
    // - Cross-browser safe: 16-64KB
    // Source: https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html
    // 🧪 TEST RESULTS: 1MB failed, 512KB failed → using spec-compliant 256KB
    CHUNK_SIZE_DEFAULT: 256 * 1024 - 64,    // 256KB - spec limit per Chrome/Firefox
    CHUNK_SIZE_SAFARI: 64 * 1024 - 64,      // 64KB - Safari conservative limit

    // ─── Buffer Limits (bytes, per channel) ─────────────────
    // Chrome closes DataChannel if bufferedAmount > 16MB (hard limit).
    // 🧪 TUNED VALUES: Balance throughput vs browser limits
    // - Keep buffer well below 16MB limit (use 12MB for safety margin)
    // - LOW_WATER_MARK at 50% allows buffer to refill without starving
    MAX_BUFFER_LAN: 12 * 1024 * 1024,   // 12MB (safe margin from Chrome's 16MB limit)
    MAX_BUFFER_WAN: 8 * 1024 * 1024,    // 8MB (WAN has higher latency, smaller buffer ok)
    MAX_BUFFER_RELAY: 4 * 1024 * 1024,  // 4MB (TURN relay is slower, avoid overfilling)
    // Resume sending when buffer drops below this threshold.
    // At 50% we maintain good pipeline utilization without risking overflow
    LOW_WATER_MARK: 6 * 1024 * 1024,    // 6MB (50% of MAX_BUFFER_LAN)

    // ─── Hashing Thresholds ─────────────────────────────────
    HASH_SUBTLE_MAX: 100 * 1024 * 1024,          // 100 MB — above this, use worker
    HASH_WORKER_CHUNK_SIZE: 2 * 1024 * 1024,     // 2 MB chunks for worker

    // ─── Timeouts (ms) ─────────────────────────────────────
    CONNECTION_TIMEOUT: 30_000,
    STABILITY_CHECK_DURATION: 1_000,
    STABILITY_CHECK_INTERVAL: 200,
    STABILITY_MAX_CV: 0.5,            // coefficient of variation threshold
    CHANNEL_OPEN_TIMEOUT: 10_000,
    BACKPRESSURE_TIMEOUT: 5_000,
    METADATA_ACK_TIMEOUT: 10_000,
    ACK_COMPLETE_TIMEOUT: 300_000,  // 5 minutes — receiver needs time for hash verification

    // ─── Wire Format ───────────────────────────────────────
    CHUNK_HEADER_SIZE: 8,

    // ─── Encryption ────────────────────────────────────────
    AES_IV_LENGTH: 12,
    AES_TAG_LENGTH: 16,               // GCM auth tag
    PBKDF2_ITERATIONS: 100_000,

    // ─── Progress Reporting ────────────────────────────────
    SPEED_EMA_ALPHA: 0.3,             // exponential moving average smoothing
} as const;

export function isSafari(): boolean {
    const ua = navigator.userAgent;
    return /^((?!chrome|android).)*safari/i.test(ua);
}

export function getMaxChannels(): number {
    return isSafari() ? TRANSFER_CONFIG.MAX_CHANNELS_SAFARI : TRANSFER_CONFIG.MAX_CHANNELS_DEFAULT;
}

export function getChunkSize(): number {
    return isSafari() ? TRANSFER_CONFIG.CHUNK_SIZE_SAFARI : TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT;
}

/**
 * Determina il numero di PeerConnections basandosi su file size e profilo.
 * Chiamare DOPO il profiling di PC0.
 * Max 4 PC per stabilità browser (6+ causano disconnections).
 */
export function getParallelConnectionCount(
    fileSize: number,
    connectionType: 'lan' | 'wan' | 'relay' | 'unknown',
): number {
    // Feature flag disabilitato → sempre 1 PC
    if (!TRANSFER_CONFIG.ENABLE_PARALLEL_MODE) return 1;

    // Safari/mobile → sempre 1 PC
    if (isSafari()) return 1;

    // Relay (TURN) → sempre 1 PC (ogni PC = allocazione relay separata)
    if (connectionType === 'relay') return 1;

    // WAN con RTT → max 2 PC (bandwidth limitata)
    if (connectionType === 'wan') {
        if (fileSize >= TRANSFER_CONFIG.PARALLEL_SIZE_THRESHOLD_2) return 2;
        return 1;
    }

    // LAN → scala fino a 4 PC in base al file size
    if (connectionType === 'lan') {
        if (fileSize >= TRANSFER_CONFIG.PARALLEL_SIZE_THRESHOLD_4) {
            return Math.min(4, TRANSFER_CONFIG.PARALLEL_CONNECTIONS);
        }
        if (fileSize >= TRANSFER_CONFIG.PARALLEL_SIZE_THRESHOLD_3) {
            return Math.min(3, TRANSFER_CONFIG.PARALLEL_CONNECTIONS);
        }
        if (fileSize >= TRANSFER_CONFIG.PARALLEL_SIZE_THRESHOLD_2) return 2;
    }

    return 1;
}
