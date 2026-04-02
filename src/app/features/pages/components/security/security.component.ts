import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, catchError, tap } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, LucideIconData, Lock, KeyRound, Hash, Cloud, Flame, ShieldCheck, Landmark } from 'lucide-angular';
import { HeaderComponent } from '@shared/components/header.component';
import { LanguageService } from '@core/services/language.service';
import { SeoService } from '@core/services/seo.service';

interface SecurityData {
    features: { icon: string; title: string; description: string }[];
}

const EMPTY: SecurityData = { features: [] };

@Component({
    selector: 'app-security',
    standalone: true,
    imports: [CommonModule, HeaderComponent, TranslateModule, LucideAngularModule],
    templateUrl: './security.component.html',
    styleUrls: ['./security.component.css']
})
export class SecurityComponent {
    readonly iconMap: Record<string, LucideIconData> = {
        lock: Lock, 'key-round': KeyRound, hash: Hash,
        cloud: Cloud, flame: Flame, 'shield-check': ShieldCheck
    };
    readonly Landmark = Landmark;

    private http = inject(HttpClient);
    private lang = inject(LanguageService);
    private seo  = inject(SeoService);

    data = toSignal(
        toObservable(this.lang.currentLang).pipe(
            tap(() => this.seo.set('SEO.SECURITY.TITLE', 'SEO.SECURITY.DESC', 'security')),
            switchMap(lang =>
                this.http.get<SecurityData>(`/assets/data/security/${lang}.json`).pipe(
                    catchError(() => this.http.get<SecurityData>('/assets/data/security/en.json'))
                )
            )
        ),
        { initialValue: EMPTY }
    );
}
