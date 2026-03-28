import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { AdBannerComponent } from '@shared/components/ad-banner.component';
import { SupabaseService } from '@core/services/supabase.service';
import { DropZoneComponent } from '@features/file-transfer/components/upload/drop-zone/drop-zone.component';
import { AdPremiumBanner } from '@shared/components/ad-premium-banner/ad-premium-banner';
import { LanguageService } from '@core/services/language.service';
import { SeoService } from '@core/services/seo.service';
import { AnalyticsService } from '@core/services/analytics.service';

type Feature = {
    icon?: string;
    title: string;
    description: string;
}

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, HeaderComponent, AdBannerComponent, DropZoneComponent, TranslateModule, AdPremiumBanner],
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
    isFreeTier = computed(() => this.supabase.currentProfile()?.tier !== 'premium');

    private seo = inject(SeoService);
    private lang = inject(LanguageService);
    private analytics = inject(AnalyticsService);

    constructor(
        private supabase: SupabaseService,
        private router: Router
    ) {
        effect(() => { this.lang.currentLang(); this.seo.set('SEO.HOME.TITLE', 'SEO.HOME.DESC'); });
    }

    ngOnInit() {
        // If already authenticated, redirect to dashboard
        if (this.supabase.isAuthenticated()) {
            this.router.navigate(['/dashboard']);
        }
    }

    navigateToUploadWithFile(file: File) {
        this.analytics.trackEvent('home_dropzone_used', {
            file_size_category: this.analytics.fileSizeCategory(file.size),
        });
        this.router.navigate(['/upload'], { state: { file } });
    }

    onUploadCtaClick() {
        this.analytics.trackEvent('home_cta_clicked', { cta: 'upload_button' });
    }

    features = signal<Feature[]>([
        { title: 'HOME.FEATURE_FAST_TITLE', description: 'HOME.FEATURE_FAST_DESC' },
        { title: 'HOME.FEATURE_SECURE_TITLE', description: 'HOME.FEATURE_SECURE_DESC' },
        { title: 'HOME.FEATURE_SIMPLE_TITLE', description: 'HOME.FEATURE_SIMPLE_DESC' },
        { title: 'HOME.FEATURE_PREMIUM_TITLE', description: 'HOME.FEATURE_PREMIUM_DESC' },
    ]);
}
