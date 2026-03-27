import { Injectable } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';

@Injectable({ providedIn: 'root' })
export class SeoService {
    constructor(
        private title: Title,
        private meta: Meta,
        private translate: TranslateService
    ) {}

    set(titleKey: string, descKey: string): void {
        const t = this.translate.instant(titleKey);
        const d = this.translate.instant(descKey);
        this.title.setTitle(t);
        this.meta.updateTag({ name: 'description', content: d });
        this.meta.updateTag({ property: 'og:title', content: t });
        this.meta.updateTag({ property: 'og:description', content: d });
    }
}
