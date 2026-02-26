import { Component, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UploadStateService } from '@features/file-transfer/services/upload-state.service';
import { SignalingService } from '@core/services/signaling.service';

@Component({
    selector: 'app-transfer-banner',
    standalone: true,
    imports: [CommonModule, DecimalPipe, TranslateModule],
    template: `
        @if (shouldShow()) {
            <div
                    class="fixed bottom-0 left-0 right-0 z-50 cursor-pointer"
                    (click)="goToUpload()"
                    role="button"
                    [attr.aria-label]="'TRANSFER_BANNER.ARIA_LABEL' | translate">

                <!-- Progress bar sottile in cima al banner -->
                <div class="h-0.5 bg-slate-800">
                    @if (st.isTransferring()) {
                        <div
                                class="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-300"
                                [style.width.%]="signaling.senderProgress()?.percentage ?? 0">
                        </div>
                    } @else {
                        <!-- Retry: barra animata indeterminata -->
                        <div class="h-full w-1/3 bg-amber-500 animate-slide"></div>
                    }
                </div>

                <div class="bg-slate-900/95 backdrop-blur-sm border-t border-slate-700 px-4 py-2.5">
                    <div class="max-w-5xl mx-auto flex items-center gap-3">

                        <!-- Icona stato -->
                        @if (st.isTransferring()) {
                            <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0"></span>
                        } @else {
                            <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
                        }

                        <!-- Nome file -->
                        <span class="text-xs font-bold text-white truncate flex-1 min-w-0">
                            {{ st.selectedFile()?.name ?? '' }}
                        </span>

                        <!-- Stats (solo durante il trasferimento) -->
                        @if (st.isTransferring()) {
                            <div class="flex items-center gap-4 shrink-0">
                                <span class="text-sm font-black font-mono text-orange-400">
                                    {{ (signaling.senderProgress()?.percentage ?? 0) | number:'1.0-1' }}%
                                </span>
                                <span class="text-xs text-slate-400 font-mono hidden sm:block">
                                    {{ formatSpeed(signaling.senderProgress()?.speed ?? 0) }}
                                </span>
                            </div>
                        } @else {
                            <span class="text-xs text-amber-400 font-bold shrink-0">{{ 'TRANSFER_BANNER.RECONNECTING' | translate }}</span>
                        }

                        <!-- CTA -->
                        <span class="text-xs font-bold text-slate-400 hidden sm:block shrink-0">
                            {{ 'TRANSFER_BANNER.CLICK_BACK' | translate }}
                        </span>
                    </div>
                </div>
            </div>
        }
    `,
    styles: [`
        @keyframes slide {
            0% {
                transform: translateX(-100%);
            }
            100% {
                transform: translateX(400%);
            }
        }

        .animate-slide {
            animation: slide 1.4s linear infinite;
        }
    `]
})
export class TransferBannerComponent {
    protected readonly st = inject(UploadStateService);
    protected readonly signaling = inject(SignalingService);
    private readonly router = inject(Router);

    shouldShow(): boolean {
        const onUploadRoute = this.router.url === '/upload';
        return !onUploadRoute && (this.st.isTransferring() || this.st.isRetrying());
    }

    goToUpload() {
        this.router.navigate(['/upload']);
    }

    formatSpeed(bytesPerSecond: number): string {
        if (bytesPerSecond === 0) return '0 B/s';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
        return Math.round(bytesPerSecond / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i] + '/s';
    }
}
