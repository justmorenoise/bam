// Production Environment Configuration
// I valori <PLACEHOLDER> vengono sostituiti a build-time dal workflow GitHub Actions
export const environment = {
    production: true,
    maintenanceMode: false,
    appName: 'Bam! - File Sharing',
    version: '1.1.27',

    // Supabase Configuration
    supabase: {
        url: '<PROD_SUPABASE_URL>',
        anonKey: '<PROD_SUPABASE_ANON_KEY>',
    },

    // Stripe Configuration
    stripe: {
        publishableKey: '<PROD_STRIPE_PUBLISHABLE_KEY>',
    },

    // WebRTC Configuration
    webrtc: {
        iceServers: [
            // Google STUN servers
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
        turnServiceApiUrl: 'https://bam.metered.live/api/v1/turn/credentials',
        turnServiceApiKey: '<PROD_TURN_API_KEY>',
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

    // Analytics Configuration (Production)
    analytics: {
        enabled: true,
        gaId: '<PROD_GA_ID>',
    },

    // Ads Configuration (Production)
    // AdSense è attivo solo su web (non su Electron).
    ads: {
        enabled: true,
        adsense: {
            publisherId: 'ca-pub-6681808248400224',
            bannerSlot: '7521901051',
            interstitialSlot: '3139669467',
        },
    },

    // Cloudflare R2 Configuration
    r2: {
        workerUrl: '<PROD_R2_WORKER_URL>',
        apiKey: '<PROD_R2_API_KEY>',
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
        baseUrl: 'https://bamfile.com',
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

    // Logging
    logging: {
        level: 'error',
        enableConsole: false,
    },
};
