import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { provideServerRendering, withRoutes, RenderMode } from '@angular/ssr';
import { appConfig } from './app.config';
import { SsrAssetsInterceptor } from './core/interceptors/ssr-assets.interceptor';

const serverConfig: ApplicationConfig = {
    providers: [
        provideServerRendering(
            withRoutes([
                { path: '',             renderMode: RenderMode.Prerender },
                { path: 'about',        renderMode: RenderMode.Prerender },
                { path: 'security',     renderMode: RenderMode.Prerender },
                { path: 'pricing',      renderMode: RenderMode.Prerender },
                { path: 'terms',        renderMode: RenderMode.Prerender },
                { path: 'privacy',      renderMode: RenderMode.Prerender },
                { path: 'en',           renderMode: RenderMode.Prerender },
                { path: 'it',           renderMode: RenderMode.Prerender },
                { path: 'en/about',     renderMode: RenderMode.Prerender },
                { path: 'en/security',  renderMode: RenderMode.Prerender },
                { path: 'en/pricing',   renderMode: RenderMode.Prerender },
                { path: 'en/terms',     renderMode: RenderMode.Prerender },
                { path: 'en/privacy',   renderMode: RenderMode.Prerender },
                { path: 'it/about',     renderMode: RenderMode.Prerender },
                { path: 'it/security',  renderMode: RenderMode.Prerender },
                { path: 'it/pricing',   renderMode: RenderMode.Prerender },
                { path: 'it/terms',     renderMode: RenderMode.Prerender },
                { path: 'it/privacy',   renderMode: RenderMode.Prerender },
                { path: '**',           renderMode: RenderMode.Client },
            ])
        ),
        { provide: HTTP_INTERCEPTORS, useClass: SsrAssetsInterceptor, multi: true }
    ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
