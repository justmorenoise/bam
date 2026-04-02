import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';

const SUPPORTED_LANGS = ['en', 'it'] as const;

@Injectable({ providedIn: 'root' })
export class SeoService {
    private title     = inject(Title);
    private meta      = inject(Meta);
    private translate = inject(TranslateService);
    private document  = inject(DOCUMENT);

    set(titleKey: string, descKey: string, pagePath?: string): void {
        this.translate.get([titleKey, descKey]).subscribe(tr => {
            const t = tr[titleKey];
            const d = tr[descKey];
            this.title.setTitle(t);
            this.meta.updateTag({ name: 'description', content: d });
            this.meta.updateTag({ property: 'og:title', content: t });
            this.meta.updateTag({ property: 'og:description', content: d });
        });

        if (pagePath !== undefined) {
            this.setHreflang(pagePath);
        }
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
