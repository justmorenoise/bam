/**
 * Bam! Language Router Worker
 *
 * Intercepts bare page routes on bamfile.com (e.g. /, /about, /pricing)
 * and issues a 302 redirect to the language-prefixed version (/it/about, /en/about)
 * based on — in order of priority:
 *   1. `bam_lang` cookie (user's explicit language choice, set by Angular's LanguageService)
 *   2. `Accept-Language` HTTP header
 *
 * Deploy this worker on Cloudflare with a route matching the bare pages,
 * e.g.:  bamfile.com/   bamfile.com/about   bamfile.com/pricing  …
 * All other requests (assets, /en/*, /it/*, /upload, /download/*…) pass through
 * untouched to Firebase Hosting.
 *
 * Setup:
 *   wrangler deploy                          # prod
 *   wrangler deploy --config wrangler.preprod.toml   # preprod
 */

// Routes that have language variants and should be redirected.
const LANG_ROUTES = new Set(['/', '/about', '/pricing', '/security', '/privacy', '/terms']);

const SUPPORTED_LANGS = ['en', 'it'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

function detectLang(request: Request): Lang {
    // 1. Cookie set by Angular's LanguageService (localStorage key "bam_lang")
    const cookie = request.headers.get('Cookie') ?? '';
    const cookieMatch = cookie.match(/\bbam_lang=([a-z]{2})\b/);
    if (cookieMatch && SUPPORTED_LANGS.includes(cookieMatch[1] as Lang)) {
        return cookieMatch[1] as Lang;
    }

    // 2. Accept-Language header — use the first preferred language
    const acceptLang = (request.headers.get('Accept-Language') ?? '').toLowerCase();
    for (const lang of SUPPORTED_LANGS) {
        if (acceptLang.startsWith(lang) || acceptLang.includes(`,${lang}`) || acceptLang.includes(` ${lang}`)) {
            return lang;
        }
    }

    return 'en'; // default
}

export default {
    async fetch(request: Request): Promise<Response> {
        const url  = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '') || '/'; // normalise trailing slash

        if (!LANG_ROUTES.has(path)) {
            // Not a bare page route — pass through to Firebase Hosting
            return fetch(request);
        }

        const lang       = detectLang(request);
        const page       = path === '/' ? '' : path;           // '' → /it   '/about' → /it/about
        const targetPath = `/${lang}${page}`;

        // Preserve query string if present
        const location = targetPath + (url.search ?? '');

        return Response.redirect(`${url.origin}${location}`, 302);
    },
};
