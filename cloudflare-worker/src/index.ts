/**
 * Bam! R2 Transfer Worker
 *
 * Handles cloud-based file transfers via Cloudflare R2.
 * Supports:
 *   - Burn streaming: chunked upload/download, chunks deleted after ack
 *   - Cloud (premium): full multipart upload, configurable retention 1-3 days
 *
 * Bucket structure:
 *   {token}/_meta.json      — transfer metadata
 *   {token}/file            — the uploaded file (cloud mode)
 *   {token}/chunks/{n}      — individual chunks (burn streaming mode)
 */

// ─── Types ──────────────────────────────────────────────────

interface Env {
    BAM_BUCKET: R2Bucket;
    API_KEY: string;
    ALLOWED_ORIGINS: string;
}

type RetentionPolicy = 'burn' | '3day' | 'permanent';

interface TransferMeta {
    fileName: string;
    fileSize: number;
    fileHash: string;
    contentType: string;
    retentionPolicy: RetentionPolicy;
    createdAt: number;
    expiresAt: number | null;
    uploaded: boolean;
    totalChunks?: number;  // set for burn streaming transfers
}

interface CreateTransferBody {
    fileName: string;
    fileSize: number;
    fileHash: string;
    contentType: string;
    retentionPolicy: RetentionPolicy;
    totalChunks?: number;  // required for burn streaming transfers
}

// ─── Size limits per tier ───────────────────────────────────

const SIZE_LIMITS: Record<string, number> = {
    free: 500 * 1024 * 1024,       // 500 MB
    premium: 2 * 1024 * 1024 * 1024, // 2 GB
};

// Multipart thresholds (used by Angular client — kept here for reference)
// Threshold: 100 MB; Part size: 10 MB per part (minimum 5 MB for R2)

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const BURN_SAFETY_NET_MS = 24 * 60 * 60 * 1000; // 24h safety net for failed burn deletes

// ─── Helpers ────────────────────────────────────────────────

function corsHeaders(request: Request, env: Env): Record<string, string> {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());

    // In development, allow the requesting origin if it matches any allowed pattern
    const isAllowed = allowed.includes(origin) || allowed.includes('*');

    return {
        'Access-Control-Allow-Origin': isAllowed ? origin : allowed[0],
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Bam-Api-Key, X-Bam-Tier',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonResponse(data: unknown, status: number, request: Request, env: Env): Response {
    return Response.json(data, {
        status,
        headers: corsHeaders(request, env),
    });
}

function errorResponse(message: string, status: number, request: Request, env: Env): Response {
    return jsonResponse({ error: message }, status, request, env);
}

function authenticate(request: Request, env: Env): boolean {
    const apiKey = request.headers.get('X-Bam-Api-Key');
    return apiKey === env.API_KEY;
}

function getTier(request: Request): string {
    return request.headers.get('X-Bam-Tier') || 'free';
}

function metaKey(token: string): string {
    return `${token}/_meta.json`;
}

function fileKey(token: string): string {
    return `${token}/file`;
}

function chunkKey(token: string, index: number): string {
    return `${token}/chunks/${index}`;
}

async function getMeta(bucket: R2Bucket, token: string): Promise<TransferMeta | null> {
    const obj = await bucket.get(metaKey(token));
    if (!obj) return null;
    return obj.json<TransferMeta>();
}

async function putMeta(bucket: R2Bucket, token: string, meta: TransferMeta): Promise<void> {
    await bucket.put(metaKey(token), JSON.stringify(meta), {
        httpMetadata: { contentType: 'application/json' },
    });
}

function computeExpiresAt(policy: RetentionPolicy): number | null {
    if (policy === '3day') return Date.now() + THREE_DAYS_MS;
    return null; // burn deletes on download, permanent has no expiry
}

// ─── Route extraction ───────────────────────────────────────

function extractToken(path: string): string | null {
    // /transfer/{token}[/...]
    const match = path.match(/^\/transfer\/([a-f0-9-]{36})(\/|$)/);
    return match ? match[1] : null;
}

// ─── Request handler ────────────────────────────────────────

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request, env) });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // ── POST /transfer ─────────────────────────────────
            if (request.method === 'POST' && path === '/transfer') {
                return handleCreateTransfer(request, env);
            }

            // ── PUT /transfer/:token/upload ────────────────────
            if (request.method === 'PUT' && /^\/transfer\/[^/]+\/upload$/.test(path)) {
                return handleSingleUpload(request, env);
            }

            // ── POST /transfer/:token/multipart/create ─────────
            if (request.method === 'POST' && /^\/transfer\/[^/]+\/multipart\/create$/.test(path)) {
                return handleMultipartCreate(request, env);
            }

            // ── PUT /transfer/:token/multipart/:uploadId/:partNumber ──
            if (request.method === 'PUT' && /^\/transfer\/[^/]+\/multipart\/[^/]+\/\d+$/.test(path)) {
                return handleMultipartPart(request, env);
            }

            // ── POST /transfer/:token/multipart/complete ───────
            if (request.method === 'POST' && /^\/transfer\/[^/]+\/multipart\/complete$/.test(path)) {
                return handleMultipartComplete(request, env);
            }

            // ── GET /transfer/:token/status ────────────────────
            if (request.method === 'GET' && /^\/transfer\/[^/]+\/status$/.test(path)) {
                return handleStatus(request, env);
            }

            // ── GET /transfer/:token ───────────────────────────
            if (request.method === 'GET' && /^\/transfer\/[a-f0-9-]{36}$/.test(path)) {
                return handleDownload(request, env, ctx);
            }

            // ── DELETE /transfer/:token ─────────────────────────
            if (request.method === 'DELETE' && /^\/transfer\/[a-f0-9-]{36}$/.test(path)) {
                return handleDelete(request, env);
            }

            // ── PUT /transfer/:token/chunks/:n ─────────────────── (burn streaming)
            if (request.method === 'PUT' && /^\/transfer\/[^/]+\/chunks\/\d+$/.test(path)) {
                return handleUploadChunk(request, env);
            }

            // ── GET /transfer/:token/chunks/:n ─────────────────── (burn streaming)
            if (request.method === 'GET' && /^\/transfer\/[^/]+\/chunks\/\d+$/.test(path)) {
                return handleDownloadChunk(request, env);
            }

            // ── DELETE /transfer/:token/chunks/:n ──────────────── (burn streaming)
            if (request.method === 'DELETE' && /^\/transfer\/[^/]+\/chunks\/\d+$/.test(path)) {
                return handleDeleteChunk(request, env);
            }

            return errorResponse('Not found', 404, request, env);
        } catch (err) {
            console.error('Worker error:', err);
            return errorResponse('Internal server error', 500, request, env);
        }
    },

    // ── Scheduled cleanup ──────────────────────────────────────
    async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
        await cleanupExpiredTransfers(env);
    },
};

// ─── Endpoint handlers ──────────────────────────────────────

async function handleCreateTransfer(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const body = await request.json<CreateTransferBody>();

    if (!body.fileName || !body.fileSize || !body.contentType || !body.retentionPolicy) {
        return errorResponse('Missing required fields: fileName, fileSize, contentType, retentionPolicy', 400, request, env);
    }

    if (!['burn', '3day', 'permanent'].includes(body.retentionPolicy)) {
        return errorResponse('Invalid retentionPolicy. Must be: burn, 3day, or permanent', 400, request, env);
    }

    // Validate file size against tier limit
    const tier = getTier(request);
    const maxSize = SIZE_LIMITS[tier] || SIZE_LIMITS.free;
    if (body.fileSize > maxSize) {
        return errorResponse(
            `File too large. Max size for ${tier} tier: ${Math.round(maxSize / (1024 * 1024))}MB`,
            413,
            request,
            env,
        );
    }

    const token = crypto.randomUUID();
    const meta: TransferMeta = {
        fileName: body.fileName,
        fileSize: body.fileSize,
        fileHash: body.fileHash || '',
        contentType: body.contentType,
        retentionPolicy: body.retentionPolicy,
        createdAt: Date.now(),
        expiresAt: computeExpiresAt(body.retentionPolicy),
        uploaded: false,
        ...(body.totalChunks !== undefined ? { totalChunks: body.totalChunks } : {}),
    };

    await putMeta(env.BAM_BUCKET, token, meta);

    return jsonResponse(
        {
            token,
            uploadUrl: `/transfer/${token}/upload`,
            multipartUrl: `/transfer/${token}/multipart/create`,
            maxSize,
        },
        200,
        request,
        env,
    );
}

async function handleSingleUpload(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const token = extractToken(new URL(request.url).pathname);
    if (!token) return errorResponse('Invalid token', 400, request, env);

    const meta = await getMeta(env.BAM_BUCKET, token);
    if (!meta) return errorResponse('Transfer not found', 404, request, env);
    if (meta.uploaded) return errorResponse('File already uploaded', 409, request, env);

    if (!request.body) return errorResponse('No body', 400, request, env);

    await env.BAM_BUCKET.put(fileKey(token), request.body, {
        httpMetadata: { contentType: meta.contentType },
        customMetadata: {
            fileName: meta.fileName,
            retentionPolicy: meta.retentionPolicy,
            expiresAt: meta.expiresAt?.toString() || '',
        },
    });

    meta.uploaded = true;
    await putMeta(env.BAM_BUCKET, token, meta);

    return jsonResponse({ status: 'uploaded' }, 200, request, env);
}

async function handleMultipartCreate(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const token = extractToken(new URL(request.url).pathname);
    if (!token) return errorResponse('Invalid token', 400, request, env);

    const meta = await getMeta(env.BAM_BUCKET, token);
    if (!meta) return errorResponse('Transfer not found', 404, request, env);
    if (meta.uploaded) return errorResponse('File already uploaded', 409, request, env);

    const multipartUpload = await env.BAM_BUCKET.createMultipartUpload(fileKey(token), {
        httpMetadata: { contentType: meta.contentType },
        customMetadata: {
            fileName: meta.fileName,
            retentionPolicy: meta.retentionPolicy,
            expiresAt: meta.expiresAt?.toString() || '',
        },
    });

    return jsonResponse({ uploadId: multipartUpload.uploadId }, 200, request, env);
}

async function handleMultipartPart(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    // /transfer/{token}/multipart/{uploadId}/{partNumber}
    const token = parts[2];
    const uploadId = parts[4];
    const partNumber = parseInt(parts[5], 10);

    if (!token || !uploadId || isNaN(partNumber)) {
        return errorResponse('Invalid multipart path', 400, request, env);
    }

    if (!request.body) return errorResponse('No body', 400, request, env);

    const multipartUpload = env.BAM_BUCKET.resumeMultipartUpload(fileKey(token), uploadId);
    const part = await multipartUpload.uploadPart(partNumber, request.body);

    return jsonResponse({ etag: part.etag, partNumber: part.partNumber }, 200, request, env);
}

async function handleMultipartComplete(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const token = extractToken(new URL(request.url).pathname);
    if (!token) return errorResponse('Invalid token', 400, request, env);

    const body = await request.json<{
        uploadId: string;
        parts: Array<{ partNumber: number; etag: string }>;
    }>();

    if (!body.uploadId || !body.parts?.length) {
        return errorResponse('Missing uploadId or parts', 400, request, env);
    }

    const multipartUpload = env.BAM_BUCKET.resumeMultipartUpload(fileKey(token), body.uploadId);

    const uploadedParts = body.parts.map(p => ({
        partNumber: p.partNumber,
        etag: p.etag,
    }));

    await multipartUpload.complete(uploadedParts);

    // Mark as uploaded
    const meta = await getMeta(env.BAM_BUCKET, token);
    if (meta) {
        meta.uploaded = true;
        await putMeta(env.BAM_BUCKET, token, meta);
    }

    return jsonResponse({ status: 'uploaded' }, 200, request, env);
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
    const token = extractToken(new URL(request.url).pathname);
    if (!token) return errorResponse('Invalid token', 400, request, env);

    const meta = await getMeta(env.BAM_BUCKET, token);
    if (!meta || !meta.uploaded) {
        return jsonResponse({ exists: false }, 200, request, env);
    }

    // Check if expired
    if (meta.expiresAt && Date.now() > meta.expiresAt) {
        return jsonResponse({ exists: false, expired: true }, 200, request, env);
    }

    return jsonResponse(
        {
            exists: true,
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            fileHash: meta.fileHash,
            contentType: meta.contentType,
            retentionPolicy: meta.retentionPolicy,
            expiresAt: meta.expiresAt,
            createdAt: meta.createdAt,
            totalChunks: meta.totalChunks ?? null,
        },
        200,
        request,
        env,
    );
}

async function handleDownload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const token = extractToken(new URL(request.url).pathname);
    if (!token) return errorResponse('Invalid token', 400, request, env);

    const meta = await getMeta(env.BAM_BUCKET, token);
    if (!meta || !meta.uploaded) {
        return errorResponse('File not found', 404, request, env);
    }

    // Check expiry
    if (meta.expiresAt && Date.now() > meta.expiresAt) {
        // Clean up expired file
        ctx.waitUntil(deleteTransfer(env.BAM_BUCKET, token));
        return errorResponse('File expired', 410, request, env);
    }

    const file = await env.BAM_BUCKET.get(fileKey(token));
    if (!file) {
        return errorResponse('File not found in storage', 404, request, env);
    }

    const headers: Record<string, string> = {
        ...corsHeaders(request, env),
        'Content-Type': meta.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(meta.fileName)}"`,
    };

    if (meta.fileSize) {
        headers['Content-Length'] = meta.fileSize.toString();
    }

    // Burn mode: delete after download completes
    if (meta.retentionPolicy === 'burn') {
        headers['Cache-Control'] = 'no-store';
        ctx.waitUntil(deleteTransfer(env.BAM_BUCKET, token));
    }

    return new Response(file.body, { headers });
}

async function handleDelete(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const token = extractToken(new URL(request.url).pathname);
    if (!token) return errorResponse('Invalid token', 400, request, env);

    const meta = await getMeta(env.BAM_BUCKET, token);
    if (!meta) return errorResponse('Transfer not found', 404, request, env);

    await deleteTransfer(env.BAM_BUCKET, token);
    return jsonResponse({ status: 'deleted' }, 200, request, env);
}

// ─── Burn streaming chunk handlers ──────────────────────────

async function handleUploadChunk(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const parts = new URL(request.url).pathname.split('/');
    // /transfer/{token}/chunks/{index}
    const token = parts[2];
    const chunkIndex = parseInt(parts[4], 10);

    if (!token || isNaN(chunkIndex)) {
        return errorResponse('Invalid path', 400, request, env);
    }

    const meta = await getMeta(env.BAM_BUCKET, token);
    if (!meta) return errorResponse('Transfer not found', 404, request, env);

    if (!request.body) return errorResponse('No body', 400, request, env);

    await env.BAM_BUCKET.put(chunkKey(token, chunkIndex), request.body, {
        httpMetadata: { contentType: 'application/octet-stream' },
    });

    return jsonResponse({ status: 'ok', chunkIndex }, 200, request, env);
}

async function handleDownloadChunk(request: Request, env: Env): Promise<Response> {
    const parts = new URL(request.url).pathname.split('/');
    const token = parts[2];
    const chunkIndex = parseInt(parts[4], 10);

    if (!token || isNaN(chunkIndex)) {
        return errorResponse('Invalid path', 400, request, env);
    }

    const obj = await env.BAM_BUCKET.get(chunkKey(token, chunkIndex));
    if (!obj) return errorResponse('Chunk not found', 404, request, env);

    return new Response(obj.body, {
        headers: {
            ...corsHeaders(request, env),
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store',
        },
    });
}

async function handleDeleteChunk(request: Request, env: Env): Promise<Response> {
    if (!authenticate(request, env)) {
        return errorResponse('Unauthorized', 401, request, env);
    }

    const parts = new URL(request.url).pathname.split('/');
    const token = parts[2];
    const chunkIndex = parseInt(parts[4], 10);

    if (!token || isNaN(chunkIndex)) {
        return errorResponse('Invalid path', 400, request, env);
    }

    await env.BAM_BUCKET.delete(chunkKey(token, chunkIndex));
    return jsonResponse({ status: 'deleted', chunkIndex }, 200, request, env);
}

// ─── Cleanup ────────────────────────────────────────────────

async function deleteBurnChunks(bucket: R2Bucket, token: string): Promise<void> {
    let cursor: string | undefined;
    const prefix = `${token}/chunks/`;
    do {
        const listed = await bucket.list({ prefix, cursor, limit: 1000 });
        if (listed.objects.length > 0) {
            await bucket.delete(listed.objects.map(o => o.key));
        }
        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
}

async function deleteTransfer(bucket: R2Bucket, token: string): Promise<void> {
    await Promise.all([
        bucket.delete(fileKey(token)),
        bucket.delete(metaKey(token)),
        deleteBurnChunks(bucket, token),
    ]);
}

async function cleanupExpiredTransfers(env: Env): Promise<void> {
    const now = Date.now();
    let cursor: string | undefined;
    let deletedCount = 0;

    do {
        const listed = await env.BAM_BUCKET.list({
            prefix: '',
            cursor,
            limit: 500,
        });

        // Find all _meta.json files
        const metaObjects = listed.objects.filter(obj => obj.key.endsWith('/_meta.json'));

        for (const metaObj of metaObjects) {
            try {
                const obj = await env.BAM_BUCKET.get(metaObj.key);
                if (!obj) continue;

                const meta = await obj.json<TransferMeta>();
                const token = metaObj.key.split('/')[0];
                let shouldDelete = false;

                if (meta.retentionPolicy === '3day' && meta.expiresAt && now > meta.expiresAt) {
                    shouldDelete = true;
                }

                // Safety net: burn files older than 24h that weren't deleted on download
                if (meta.retentionPolicy === 'burn' && (now - meta.createdAt) > BURN_SAFETY_NET_MS) {
                    shouldDelete = true;
                }

                if (shouldDelete) {
                    await deleteTransfer(env.BAM_BUCKET, token);
                    deletedCount++;
                }
            } catch (err) {
                console.error(`Cleanup error for ${metaObj.key}:`, err);
            }
        }

        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    console.log(`[CLEANUP] Deleted ${deletedCount} expired transfers`);
}
