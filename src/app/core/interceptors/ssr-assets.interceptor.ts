import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpResponse } from '@angular/common/http';
import { isPlatformServer } from '@angular/common';
import { of } from 'rxjs';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Interceptor attivo solo durante il prerendering SSR.
 * Intercetta le richieste a `/assets/...` e le serve direttamente
 * dal filesystem (src/assets/) senza bisogno di un server HTTP locale.
 */
@Injectable()
export class SsrAssetsInterceptor implements HttpInterceptor {
    private readonly platformId = inject(PLATFORM_ID);

    intercept(req: HttpRequest<unknown>, next: HttpHandler) {
        if (!isPlatformServer(this.platformId)) {
            return next.handle(req);
        }

        const url = req.url;
        if (!url.startsWith('/assets/')) {
            return next.handle(req);
        }

        try {
            const relativePath = url.replace(/^\//, '');
            const filePath = join(process.cwd(), 'src', relativePath);
            console.log('[SSR Interceptor] Serving from disk:', filePath);
            const content = readFileSync(filePath, 'utf-8');
            const body = req.responseType === 'json' ? JSON.parse(content) : content;
            return of(new HttpResponse({ status: 200, body, url }));
        } catch (e) {
            console.log('[SSR Interceptor] File not found, passing through:', url, e);
            return next.handle(req);
        }
    }
}
