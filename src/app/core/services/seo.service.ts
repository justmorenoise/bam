import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from './language.service';

const SUPPORTED_LANGS = ['en', 'it'] as const;
const OG_IMAGE_LANGS  = ['en', 'it'] as const;

@Injectable({ providedIn: 'root' })
export class SeoService {
    private title     = inject(Title);
    private meta      = inject(Meta);
    private translate = inject(TranslateService);
    private document  = inject(DOCUMENT);
    private langSvc   = inject(LanguageService);

    set(titleKey: string, descKey: string, pagePath?: string): void {
        const lang    = this.langSvc.currentLang();
        const imgLang = (OG_IMAGE_LANGS as readonly string[]).includes(lang) ? lang : 'en';
        const origin  = this.document.location.origin;
        this.meta.updateTag({ property: 'og:image', content: `${origin}/assets/imgs/share/bamfile_${imgLang}.jpg` });

        this.translate.use(lang).subscribe(translations => {
            const t = this.resolve(translations, titleKey);
            const d = this.resolve(translations, descKey);
            this.title.setTitle(t);
            this.meta.updateTag({ name: 'description', content: d });
            this.meta.updateTag({ property: 'og:title', content: t });
            this.meta.updateTag({ property: 'og:description', content: d });
        });

        if (pagePath !== undefined) {
            this.setHreflang(pagePath);
        }
    }

    private resolve(translations: Record<string, unknown>, key: string): string {
        const result = key.split('.').reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], translations);
        return typeof result === 'string' ? result : key;
    }

    private setHreflang(pagePath: string): void {
        const origin = this.document.location.origin;
        const head   = this.document.head;

        // Remove existing hreflang links
        head.querySelectorAll('link[rel="alternate"][hreflang]').forEach(el => el.remove());

        for (const lang of SUPPORTED_LANGS) {
            const href = pagePath ? `${origin}/${lang}/${pagePath}` : `${origin}/${lang}`;
            const link = this.document.createElement('link');
            link.setAttribute('rel', 'alternate');
            link.setAttribute('hreflang', lang);
            link.setAttribute('href', href);
            head.appendChild(link);
        }

        // x-default punta all'inglese
        const defaultHref = pagePath ? `${origin}/en/${pagePath}` : `${origin}/en`;
        const xDefault = this.document.createElement('link');
        xDefault.setAttribute('rel', 'alternate');
        xDefault.setAttribute('hreflang', 'x-default');
        xDefault.setAttribute('href', defaultHref);
        head.appendChild(xDefault);
    }
}
