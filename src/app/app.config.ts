import { ApplicationConfig } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';

// // Factory function for TranslateHttpLoader
// export function HttpLoaderFactory(http: HttpClient) {
//     return new TranslateHttpLoader(http, './assets/i18n/', '.json');
// }

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(
            routes,
            withInMemoryScrolling({
                scrollPositionRestoration: 'top',
                anchorScrolling: 'enabled',
            })
        ),
        provideClientHydration(withEventReplay()),
        provideHttpClient(withFetch(), withInterceptorsFromDi()),
        provideTranslateService({
            fallbackLang: 'en',
            lang: 'en'
        }),
        ...provideTranslateHttpLoader({
            prefix: '/assets/i18n/',
            suffix: '.json'
        }),
    ],
};
