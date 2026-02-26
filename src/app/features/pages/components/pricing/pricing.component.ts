import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, catchError } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { LanguageService } from '@core/services/language.service';

interface PricingData {
    plans: {
        name: string;
        subtitle: string;
        price: string;
        period: string;
        highlight: boolean;
        features: { text: string; included: boolean }[];
    }[];
    faqs: { question: string; answer: string }[];
}

const EMPTY: PricingData = { plans: [], faqs: [] };

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, RouterLink, HeaderComponent, TranslateModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.css']
})
export class PricingComponent {
    private http = inject(HttpClient);
    private lang = inject(LanguageService);

    data = toSignal(
        toObservable(this.lang.currentLang).pipe(
            switchMap(lang =>
                this.http.get<PricingData>(`/assets/data/pricing/${lang}.json`).pipe(
                    catchError(() => this.http.get<PricingData>('/assets/data/pricing/en.json'))
                )
            )
        ),
        { initialValue: EMPTY }
    );
}
