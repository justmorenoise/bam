import { Component, computed, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '@shared/components/header.component';
import { AdBannerComponent } from '@shared/components/ad-banner.component';
import { FileTransferRecord, SupabaseService } from '@core/services/supabase.service';
import { ModalService } from '@core/services/modal.service';
import { DropZoneComponent } from '@features/file-transfer/components/upload/drop-zone/drop-zone.component';
import { AdPremiumBanner } from '@shared/components/ad-premium-banner/ad-premium-banner';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule, RouterLink, HeaderComponent, AdBannerComponent, DropZoneComponent, TranslateModule, AdPremiumBanner],
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
    protected readonly Math = Math;
    userProfile = this.supabase.currentProfile;
    transfers = signal<FileTransferRecord[]>([]);
    isLoading = signal(true);
    isFreeTier = computed(() => this.userProfile()?.tier !== 'premium');

    // UI State signals
    activeTab = signal<'all' | 'completed' | 'burn' | 'seed'>('all');
    searchQuery = signal('');
    sortBy = signal<'created_at' | 'file_name' | 'file_size'>('created_at');
    sortDirection = signal<'asc' | 'desc'>('desc');
    currentPage = signal(0);
    itemsPerPage = 10;

    // Computed values
    userLevel = computed(() => {
        const xp = this.userProfile()?.xp_points || 0;
        return Math.floor(xp / 100) + 1;
    });

    xpProgress = computed(() => {
        const xp = this.userProfile()?.xp_points || 0;
        const currentLevelXP = (this.userLevel() - 1) * 100;
        const xpInLevel = xp - currentLevelXP;
        return (xpInLevel / 100) * 100;
    });

    totalTransfers = computed(() => this.transfers().length);
    activeTransfers = computed(() =>
        this.transfers().filter(t => t.status === 'active').length
    );
    totalDownloads = computed(() =>
        this.transfers().reduce((sum, t) => sum + t.downloads_count, 0)
    );

    // Computed: Pipeline filtraggio → ricerca → ordinamento → paginazione

    // 1. Filtra per tab attivo
    filteredByTab = computed(() => {
        const tab = this.activeTab();
        const transfers = this.transfers();

        switch (tab) {
            case 'completed':
                return transfers.filter(t => t.status === 'completed');
            case 'burn':
                return transfers.filter(t => t.mode === 'burn');
            case 'seed':
                return transfers.filter(t => t.mode === 'seed');
            case 'all':
            default:
                return transfers;
        }
    });

    // 2. Applica ricerca su risultati filtrati
    searchedTransfers = computed(() => {
        const query = this.searchQuery().toLowerCase().trim();
        if (!query) return this.filteredByTab();

        return this.filteredByTab().filter(t =>
            t.file_name.toLowerCase().includes(query)
        );
    });

    // 3. Ordina risultati
    sortedTransfers = computed(() => {
        const transfers = [...this.searchedTransfers()];
        const sortBy = this.sortBy();
        const direction = this.sortDirection();

        transfers.sort((a, b) => {
            let comparison = 0;

            if (sortBy === 'file_name') {
                comparison = a.file_name.localeCompare(b.file_name);
            } else if (sortBy === 'file_size') {
                comparison = a.file_size - b.file_size;
            } else { // created_at
                comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            }

            return direction === 'asc' ? comparison : -comparison;
        });

        return transfers;
    });

    // 4. Pagina risultati
    paginatedTransfers = computed(() => {
        const transfers = this.sortedTransfers();
        const page = this.currentPage();
        const start = page * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        return transfers.slice(start, end);
    });

    // Computed: Totale pagine
    totalPages = computed(() =>
        Math.ceil(this.sortedTransfers().length / this.itemsPerPage)
    );

    // Computed: Conteggi per badge tab
    tabCounts = computed(() => ({
        all: this.transfers().length,
        completed: this.transfers().filter(t => t.status === 'completed').length,
        burn: this.transfers().filter(t => t.mode === 'burn').length,
        seed: this.transfers().filter(t => t.mode === 'seed').length
    }));

    constructor(
        private supabase: SupabaseService,
        private modalService: ModalService,
        private router: Router,
        private translate: TranslateService
    ) {
    }

    async ngOnInit() {
        await this.loadTransfers();
    }

    navigateToUploadWithFile(file: File) {
        this.router.navigate(['/upload'], { state: { file } });
    }

    async loadTransfers() {
        this.isLoading.set(true);
        try {
            const userId = this.supabase.currentUser()?.id;
            if (userId) {
                const data = await this.supabase.getUserTransfers(userId);
                this.transfers.set(data);
            }
        } catch (error) {
            console.error('Error loading transfers:', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    formatDate(dateString: string): string {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return this.translate.instant('DASHBOARD.DATE_TODAY');
        if (days === 1) return this.translate.instant('DASHBOARD.DATE_YESTERDAY');
        if (days < 7) return this.translate.instant('DASHBOARD.DATE_DAYS_AGO', { days });

        const locale = this.translate.getCurrentLang() === 'it' ? 'it-IT' : 'en-US';
        return date.toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    getStatusColor(status: string): string {
        switch (status) {
            case 'active':
                return 'text-green-400 bg-green-500/10 border-green-500/30';
            case 'completed':
                return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
            case 'expired':
                return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
            default:
                return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
        }
    }

    getStatusLabel(status: string): string {
        switch (status) {
            case 'active':
                return this.translate.instant('DASHBOARD.STATUS_ACTIVE');
            case 'completed':
                return this.translate.instant('DASHBOARD.STATUS_COMPLETED');
            case 'expired':
                return this.translate.instant('DASHBOARD.STATUS_EXPIRED');
            default:
                return status;
        }
    }

    copyLinkToClipboard(linkId: string) {
        const link = `${window.location.origin}/download/${linkId}`;
        navigator.clipboard.writeText(link);
        alert(this.translate.instant('DASHBOARD.COPY_SUCCESS'));
    }

    // Metodi UI per tab, ricerca, ordinamento, paginazione, eliminazione

    setActiveTab(tab: 'all' | 'completed' | 'burn' | 'seed') {
        this.activeTab.set(tab);
        this.currentPage.set(0); // Reset pagination quando cambia filtro
    }

    onSearch(event: Event) {
        const query = (event.target as HTMLInputElement).value;
        this.searchQuery.set(query);
        this.currentPage.set(0); // Reset pagination
    }

    toggleSort(field: 'created_at' | 'file_name' | 'file_size') {
        if (this.sortBy() === field) {
            // Se già ordinato per questo campo, inverte direzione
            this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
        } else {
            // Se nuovo campo, imposta campo e direzione di default
            this.sortBy.set(field);
            this.sortDirection.set('desc');
        }
    }

    nextPage() {
        if (this.currentPage() < this.totalPages() - 1) {
            this.currentPage.update(p => p + 1);
        }
    }

    previousPage() {
        if (this.currentPage() > 0) {
            this.currentPage.update(p => p - 1);
        }
    }

    goToPage(page: number) {
        if (page >= 0 && page < this.totalPages()) {
            this.currentPage.set(page);
        }
    }

    async deleteTransfer(transfer: FileTransferRecord) {
        this.modalService.showConfirm(
            this.translate.instant('DASHBOARD.DELETE_TITLE'),
            this.translate.instant('DASHBOARD.DELETE_MSG', { filename: transfer.file_name }),
            this.translate.instant('DASHBOARD.DELETE_CONFIRM'),
            this.translate.instant('DASHBOARD.DELETE_CANCEL')
        ).subscribe(async (confirmed) => {
            if (confirmed) {
                try {
                    await this.supabase.deleteFileTransfer(transfer.link_id);
                    await this.loadTransfers();
                } catch (error) {
                    console.error('Delete error:', error);
                    this.modalService.showError(
                        this.translate.instant('DASHBOARD.DELETE_ERROR_TITLE'),
                        this.translate.instant('DASHBOARD.DELETE_ERROR_MSG')
                    );
                }
            }
        });
    }
}
