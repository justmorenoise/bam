import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, catchError } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { LanguageService } from '@core/services/language.service';

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
    imports: [CommonModule, HeaderComponent, TranslateModule],
    templateUrl: './about.component.html',
    styleUrls: ['./about.component.css']
})
export class AboutComponent {
    private http = inject(HttpClient);
    private lang = inject(LanguageService);

    data = toSignal(
        toObservable(this.lang.currentLang).pipe(
            switchMap(lang =>
                this.http.get<AboutData>(`/assets/data/about/${lang}.json`).pipe(
                    catchError(() => this.http.get<AboutData>('/assets/data/about/en.json'))
                )
            )
        ),
        { initialValue: EMPTY }
    );
}
