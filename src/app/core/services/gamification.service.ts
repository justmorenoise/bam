import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Badge {
    id: string;
    name: string;
    description: string;
    icon: string;
    requirement: (stats: UserStats) => boolean;
}

export interface UserStats {
    totalFilesSent: number;
    totalFilesReceived: number;
    totalBytesSent: number;
    totalBytesReceived: number;
    xpPoints: number;
}

export interface XPEvent {
    action: 'file_sent' | 'file_received' | 'first_file' | 'milestone_100';
    points: number;
    description: string;
}

export interface LevelInfo {
    level: number;
    name: string;
    minXP: number;
    maxXP: number;
    progress: number; // 0-100%
}

const LEVELS: { name: string; minXP: number }[] = [
    { name: 'Novizio', minXP: 0 },
    { name: 'Esploratore', minXP: 50 },
    { name: 'Condivisore', minXP: 150 },
    { name: 'Veterano', minXP: 400 },
    { name: 'Esperto', minXP: 800 },
    { name: 'Maestro', minXP: 1500 },
    { name: 'Leggenda', minXP: 3000 },
    { name: 'Mito', minXP: 5000 },
];

const XP_RULES: Record<string, number> = {
    file_sent: 10,
    file_received: 5,
    first_file: 50,
    milestone_100: 100,
};

@Injectable({
    providedIn: 'root'
})
export class GamificationService {
    // Badge disponibili
    readonly badges: Badge[] = [
        {
            id: 'first_transfer',
            name: 'Primo Trasferimento',
            description: 'Completa il tuo primo trasferimento file',
            icon: '🚀',
            requirement: (stats) => stats.totalFilesSent + stats.totalFilesReceived >= 1,
        },
        {
            id: 'sender_10',
            name: 'Condivisore',
            description: 'Invia 10 file',
            icon: '📤',
            requirement: (stats) => stats.totalFilesSent >= 10,
        },
        {
            id: 'sender_100',
            name: 'Super Condivisore',
            description: 'Invia 100 file',
            icon: '🏆',
            requirement: (stats) => stats.totalFilesSent >= 100,
        },
        {
            id: 'receiver_10',
            name: 'Collezionista',
            description: 'Ricevi 10 file',
            icon: '📥',
            requirement: (stats) => stats.totalFilesReceived >= 10,
        },
        {
            id: 'gb_transferred',
            name: '1GB Trasferito',
            description: 'Trasferisci un totale di 1GB',
            icon: '💾',
            requirement: (stats) => stats.totalBytesSent + stats.totalBytesReceived >= 1024 * 1024 * 1024,
        },
        {
            id: 'xp_master',
            name: 'Maestro XP',
            description: 'Raggiungi 1000 punti XP',
            icon: '⭐',
            requirement: (stats) => stats.xpPoints >= 1000,
        },
    ];

    // Stato locale — per notifiche in-session
    lastXPEvent = signal<XPEvent | null>(null);
    lastBadgeEarned = signal<Badge | null>(null);

    constructor(private supabase: SupabaseService) {
    }

    /**
     * Calcola il livello attuale dall'XP
     */
    getLevelInfo(xp: number): LevelInfo {
        let currentLevel = 0;
        for (let i = LEVELS.length - 1; i >= 0; i--) {
            if (xp >= LEVELS[i].minXP) {
                currentLevel = i;
                break;
            }
        }

        const current = LEVELS[currentLevel];
        const next = LEVELS[currentLevel + 1];
        const maxXP = next ? next.minXP : current.minXP * 2;
        const progress = next
            ? Math.min(100, ((xp - current.minXP) / (next.minXP - current.minXP)) * 100)
            : 100;

        return {
            level: currentLevel + 1,
            name: current.name,
            minXP: current.minXP,
            maxXP,
            progress: Math.round(progress),
        };
    }

    /**
     * Assegna XP per un'azione e restituisce l'evento
     */
    async awardXP(action: 'file_sent' | 'file_received'): Promise<XPEvent | null> {
        if (!this.supabase.isAuthenticated()) return null;

        const points = XP_RULES[action] || 0;
        if (points <= 0) return null;

        const descriptions: Record<string, string> = {
            file_sent: 'File inviato',
            file_received: 'File ricevuto',
        };

        try {
            await this.supabase.addXP(points);

            const event: XPEvent = {
                action,
                points,
                description: descriptions[action] || action,
            };

            this.lastXPEvent.set(event);

            // Auto-clear dopo 3 secondi
            setTimeout(() => {
                if (this.lastXPEvent()?.action === action) {
                    this.lastXPEvent.set(null);
                }
            }, 3000);

            return event;
        } catch (e) {
            console.warn('GamificationService: failed to award XP', e);
            return null;
        }
    }

    /**
     * Controlla badge non ancora ottenuti che l'utente ha sbloccato
     */
    checkNewBadges(stats: UserStats, earnedBadgeIds: string[]): Badge[] {
        return this.badges.filter(
            badge => !earnedBadgeIds.includes(badge.id) && badge.requirement(stats)
        );
    }

    /**
     * Restituisce i punti XP per un'azione
     */
    getXPForAction(action: string): number {
        return XP_RULES[action] || 0;
    }

    /**
     * Formatta XP come stringa leggibile
     */
    formatXP(xp: number): string {
        if (xp >= 1000) {
            return (xp / 1000).toFixed(1) + 'K';
        }
        return xp.toString();
    }
}
