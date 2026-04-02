import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, catchError, map, tap } from 'rxjs/operators';
import { HeaderComponent } from '@shared/components/header.component';
import { LanguageService } from '@core/services/language.service';
import { SeoService } from '@core/services/seo.service';

@Component({
    selector: 'app-privacy',
    standalone: true,
    imports: [CommonModule, HeaderComponent],
    templateUrl: './privacy.component.html',
    styleUrls: ['./privacy.component.css']
})
export class PrivacyComponent {
    private http      = inject(HttpClient);
    private lang      = inject(LanguageService);
    private sanitizer = inject(DomSanitizer);
    private seo       = inject(SeoService);

    content = toSignal(
        toObservable(this.lang.currentLang).pipe(
            tap(() => this.seo.set('SEO.PRIVACY.TITLE', 'SEO.PRIVACY.DESC', 'privacy')),
            switchMap(lang =>
                this.http.get(`/assets/content/privacy/${lang}.html`, { responseType: 'text' }).pipe(
                    catchError(() => this.http.get('/assets/content/privacy/en.html', { responseType: 'text' }))
                )
            ),
            map(html => this.sanitizer.bypassSecurityTrustHtml(html))
        ),
        { initialValue: '' as unknown as SafeHtml }
    );
}
