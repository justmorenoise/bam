// Preprod Environment Configuration
// I valori <PLACEHOLDER> vengono sostituiti a build-time dal workflow GitHub Actions
export const environment = {
    production: false,
    maintenanceMode: false,
    appName: 'Bam! - File Sharing [PREPROD]',
    version: '1.1.31',

    // Supabase Configuration (Preprod)
    supabase: {
        url: '<PREPROD_SUPABASE_URL>',
        anonKey: '<PREPROD_SUPABASE_ANON_KEY>',
    },

    // Stripe Configuration
    stripe: {
        publishableKey: '<PREPROD_STRIPE_PUBLISHABLE_KEY>',
    },

    // WebRTC Configuration
    webrtc: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
        turnServiceApiUrl: 'https://bam.metered.live/api/v1/turn/credentials',
        turnServiceApiKey: '024c7582c4e8d641044bb44083e6727b4608',
        chunkSize: 65536, // 64KB chunks for file transfer
        maxReconnectAttempts: 5,
        connectionTimeout: 30000, // 30 seconds
        parallel: {
            enabled: true,
            maxChannels: 8,
            minFileSizeMB: 50,
            slowStartIntervalMs: 2500,
            throughputRatio: 0.7,
            saturationThreshold: 0.1
        }
    },

    // Analytics Configuration (Preprod)
    analytics: {
        enabled: true,
        gaId: '<PREPROD_GA_ID>',
    },

    // Ads Configuration (disabilitati in preprod)
    ads: {
        enabled: false,
        adsense: {
            publisherId: '',
            bannerSlot: '',
            interstitialSlot: '',
        },
    },

    // Cloudflare R2 Configuration (Preprod)
    r2: {
        workerUrl: '<PREPROD_R2_WORKER_URL>',
        apiKey: '<PREPROD_R2_API_KEY>',
    },

    // File Transfer Limits
    limits: {
        free: {
            maxFilesPerDay: 5,
            maxFileSize: 1 * 1024 * 1024 * 1024, // 1 GB
            maxCloudFileSize: 1024 * 1024 * 1024, // 1GB
        },
        premium: {
            maxFilesPerDay: null, // Unlimited
            maxFileSize: null, // Unlimited
            maxCloudFileSize: 2 * 1024 * 1024 * 1024, // 2GB
        },
    },

    // Encryption Settings
    encryption: {
        algorithm: 'AES-GCM',
        keyLength: 256,
        ivLength: 12,
        saltLength: 16,
        pbkdf2Iterations: 100000,
        hashAlgorithm: 'SHA-256',
    },

    // API Endpoints
    api: {
        baseUrl: 'https://pre.bamfile.com',
        signaling: '/api/signaling',
    },

    // Feature Flags
    features: {
        qrCodeSharing: true,
        resumeDownload: true,
        burnOnRead: true,
        seedingMode: true,
        gamification: true,
        customUrls: true,
    },

    // Logging (abilitato in preprod per debug)
    logging: {
        level: 'debug',
        enableConsole: true,
    },
};
