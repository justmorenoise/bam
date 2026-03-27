import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, catchError, tap } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, LucideIconData, Lock, Cloud, Globe, Link, Package, Zap, Shield, Monitor, Flame, Sprout, Smartphone, Gamepad2 } from 'lucide-angular';
import { HeaderComponent } from '@shared/components/header.component';
import { LanguageService } from '@core/services/language.service';
import { SeoService } from '@core/services/seo.service';

interface AboutData {
    mission:  { icon: string; title: string; description: string }[];
    steps:    { number: string; title: string; description: string }[];
    features: { icon: string; title: string; description: string }[];
    roadmap:  { icon: string; title: string; description: string }[];
}

const EMPTY: AboutData = { mission: [], steps: [], features: [], roadmap: [] };

@Component({
    selector: 'app-about',
    standalone: true,
    imports: [CommonModule, HeaderComponent, TranslateModule, LucideAngularModule],
    templateUrl: './about.component.html',
    styleUrls: ['./about.component.css']
})
export class AboutComponent {
    readonly iconMap: Record<string, LucideIconData> = {
        lock: Lock, cloud: Cloud, globe: Globe, link: Link,
        package: Package, zap: Zap, shield: Shield, monitor: Monitor,
        flame: Flame, sprout: Sprout, smartphone: Smartphone, 'gamepad-2': Gamepad2
    };

    private http = inject(HttpClient);
    private lang = inject(LanguageService);
    private seo  = inject(SeoService);

    data = toSignal(
        toObservable(this.lang.currentLang).pipe(
            tap(() => this.seo.set('SEO.ABOUT.TITLE', 'SEO.ABOUT.DESC')),
            switchMap(lang =>
                this.http.get<AboutData>(`/assets/data/about/${lang}.json`).pipe(
                    catchError(() => this.http.get<AboutData>('/assets/data/about/en.json'))
                )
            )
        ),
        { initialValue: EMPTY }
    );
}
