import { Component, computed, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { AdBannerComponent } from '@shared/components/ad-banner.component';
import { SupabaseService } from '@core/services/supabase.service';
import { DropZoneComponent } from '@features/file-transfer/components/upload/drop-zone/drop-zone.component';
import { AdPremiumBanner } from '@shared/components/ad-premium-banner/ad-premium-banner';

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

    constructor(
        private supabase: SupabaseService,
        private router: Router
    ) {
    }

    ngOnInit() {
        // If already authenticated, redirect to dashboard
        if (this.supabase.isAuthenticated()) {
            this.router.navigate(['/dashboard']);
        }
    }

    navigateToUploadWithFile(file: File) {
        this.router.navigate(['/upload'], { state: { file } });
    }

    features = signal<Feature[]>([
        { title: 'HOME.FEATURE_FAST_TITLE', description: 'HOME.FEATURE_FAST_DESC' },
        { title: 'HOME.FEATURE_SECURE_TITLE', description: 'HOME.FEATURE_SECURE_DESC' },
        { title: 'HOME.FEATURE_SIMPLE_TITLE', description: 'HOME.FEATURE_SIMPLE_DESC' },
        { title: 'HOME.FEATURE_PREMIUM_TITLE', description: 'HOME.FEATURE_PREMIUM_DESC' },
    ]);
}
