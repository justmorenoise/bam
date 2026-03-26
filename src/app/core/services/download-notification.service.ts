import { effect, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class DownloadNotificationService {
    private subscribedLinkIds = new Set<string>();

    constructor(
        private supabase: SupabaseService,
        private toast: ToastService,
        private translate: TranslateService,
    ) {
        effect(() => {
            const user = this.supabase.currentUser();
            if (user) {
                this.setup(user.id);
            } else {
                this.cleanup();
            }
        });
    }

    private async setup(userId: string): Promise<void> {
        try {
            const transfers = await this.supabase.getUserTransfers(userId);
            const activeCloud = transfers.filter(
                t => t.transfer_type === 'cloud' && t.status === 'active'
            );
            for (const transfer of activeCloud) {
                await this.subscribeForLink(transfer.link_id, transfer.file_name);
            }
        } catch {
            // silently ignore — notifications are best-effort
        }
    }

    async subscribeForLink(linkId: string, fileName: string): Promise<void> {
        if (this.subscribedLinkIds.has(linkId)) return;
        this.subscribedLinkIds.add(linkId);
        await this.supabase.subscribeToCloudNotification(linkId, (event) => {
            const key = event === 'started'
                ? 'NOTIFICATIONS.DOWNLOAD_STARTED'
                : 'NOTIFICATIONS.DOWNLOAD_COMPLETED';
            const type = event === 'completed' ? 'success' : 'info';
            const message = this.translate.instant(key, { filename: fileName });
            this.toast.show(message, type);
        });
    }

    private async cleanup(): Promise<void> {
        this.subscribedLinkIds.clear();
        await this.supabase.removeAllCloudNotifyChannels();
    }
}
