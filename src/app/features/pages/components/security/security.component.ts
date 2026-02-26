import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, catchError } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { LanguageService } from '@core/services/language.service';

interface SecurityData {
    features: { icon: string; title: string; description: string }[];
}

const EMPTY: SecurityData = { features: [] };

@Component({
    selector: 'app-security',
    standalone: true,
    imports: [CommonModule, HeaderComponent, TranslateModule],
    templateUrl: './security.component.html',
    styleUrls: ['./security.component.css']
})
export class SecurityComponent {
    private http = inject(HttpClient);
    private lang = inject(LanguageService);

    data = toSignal(
        toObservable(this.lang.currentLang).pipe(
            switchMap(lang =>
                this.http.get<SecurityData>(`/assets/data/security/${lang}.json`).pipe(
                    catchError(() => this.http.get<SecurityData>('/assets/data/security/en.json'))
                )
            )
        ),
        { initialValue: EMPTY }
    );
}
