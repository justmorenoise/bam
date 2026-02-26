import { Injectable, signal } from '@angular/core';
import { createClient, RealtimeChannel, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '@environments/environment';
import { BehaviorSubject } from 'rxjs';

export interface UserProfile {
    id: string;
    email: string;
    full_name?: string;
    avatar_url?: string;
    tier: 'free' | 'premium';
    daily_files_count: number;
    xp_points: number;
    created_at: string;
}

export interface FileTransferRecord {
    id: string;
    sender_id: string | null;
    file_name: string;
    file_size: number;
    file_hash: string;
    mode: 'burn' | 'seed';
    link_id: string;
    custom_slug?: string;
    password_protected: boolean;
    downloads_count: number;
    max_downloads?: number;
    expires_at?: string;
    created_at: string;
    status: 'active' | 'completed' | 'expired';
    deleted_at?: string | null;
}

const ANON_DAILY_COUNT_KEY = 'bam_anon_daily_count';
const LAST_UPLOAD_DATE_KEY = 'bam_last_upload_date';

@Injectable({
    providedIn: 'root'
})
export class SupabaseService {
    public supabase: SupabaseClient;
    currentUser = signal<User | null>(null);
    currentSession = signal<Session | null>(null);
    currentProfile = signal<UserProfile | null>(null);
    private signalingChannels = new Map<string, RealtimeChannel>();
    private authState$ = new BehaviorSubject<{ user: User | null; session: Session | null; }>({
        user: null,
        session: null
    });

    constructor() {
        this.supabase = createClient(environment.supabase.url, environment.supabase.anonKey);
        this.initAuth();
    }

    private async initAuth() {
        const { data } = await this.supabase.auth.getSession();
        const session = data.session;
        if (session) {
            this.currentSession.set(session);
            this.currentUser.set(session.user);
            await this.loadUserProfile(session.user.id);
        }
        this.supabase.auth.onAuthStateChange(async (event, session) => {
            this.currentSession.set(session);
            this.currentUser.set(session?.user || null);
            if (session?.user) {
                await this.loadUserProfile(session.user.id);
            } else {
                this.currentProfile.set(null);
            }
            this.authState$.next({ user: session?.user || null, session: session });
        });
    }

    async signUp(email: string, password: string, fullName?: string) {
        const { data, error } = await this.supabase.auth.signUp({
            email, password, options: {
                data: {
                    full_name: fullName
                }
            }
        });
        if (error) throw error;
        if (data.user) {
            await this.createUserProfile(data.user.id, email, fullName);
        }
        return data;
    }

    async signIn(email: string, password: string) {
        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    }

    async signInWithGoogle() {
        const { data, error } = await this.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/auth/callback',
                skipBrowserRedirect: false
            }
        });
        if (error) throw error;
        return data;
    }

    async signOut() {
        const { error } = await this.supabase.auth.signOut();
        if (error) throw error;
        this.currentUser.set(null);
        this.currentSession.set(null);
        this.currentProfile.set(null);
    }

    async resetPassword(email: string) {
        const { error } = await this.supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/auth/reset-password' });
        if (error) throw error;
    }

    private async createUserProfile(userId: string, email: string, fullName?: string) {
        const { error } = await this.supabase.from('user_profiles').insert({
            id: userId,
            email,
            full_name: fullName,
            tier: 'free',
            daily_files_count: 0,
            xp_points: 0
        });
        // Ignore conflicts (trigger already created the row) and RLS errors
        // (user has no session yet when email confirmation is required).
        // The trigger on auth.users handles profile creation reliably server-side.
        if (error && error.code !== '23505' && error.code !== '42501') {
            throw error;
        }
    }

    private async loadUserProfile(userId: string) {
        const { data, error } = await this.supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle(); // se usi supabase-js v2, meglio maybeSingle()

        if (error && error.code !== 'PGRST116') {
            console.error('Error loading profile:', error);
            return;
        }

        if (!data) {
            // Nessun profilo: crealo ora (es. per login via Google)
            const email = this.currentUser()?.email ?? '';
            await this.createUserProfile(userId, email);
            return;
        }

        this.currentProfile.set(data as UserProfile);
    }


    async updateProfile(updates: Partial<UserProfile>) {
        const userId = this.currentUser()?.id;
        if (!userId) throw new Error('No user logged in');
        const {
            data,
            error
        } = await this.supabase.from('user_profiles').update(updates).eq('id', userId).select().single();
        if (error) throw error;
        this.currentProfile.set(data as UserProfile);
        return data;
    }

    async upgradeToPremium() {
        return this.updateProfile({ tier: 'premium' });
    }

    async createFileTransfer(transfer: Omit<FileTransferRecord, 'id' | 'created_at' | 'downloads_count' | 'status'>) {
        const { data, error } = await this.supabase.from('file_transfers').insert({
            ...transfer,
            downloads_count: 0,
            status: 'active'
        }).select().single();
        if (error) throw error;
        return data as FileTransferRecord;
    }

    async getFileTransfer(linkIdOrSlug: string) {
        // Prima cerca per link_id
        const {
            data,
            error
        } = await this.supabase.from('file_transfers').select('*').eq('link_id', linkIdOrSlug).maybeSingle();
        if (error) throw error;
        if (data) return data as FileTransferRecord;

        // Fallback: cerca per custom_slug
        const {
            data: slugData,
            error: slugError
        } = await this.supabase.from('file_transfers').select('*').eq('custom_slug', linkIdOrSlug).maybeSingle();
        if (slugError) throw slugError;
        if (slugData) return slugData as FileTransferRecord;

        throw new Error('File transfer not found');
    }

    async getUserTransfers(userId: string) {
        const {
            data,
            error
        } = await this.supabase.from('file_transfers').select('*').eq('sender_id', userId).is('deleted_at', null).order('created_at', { ascending: false });
        if (error) throw error;
        return data as FileTransferRecord[];
    }

    async incrementDownloadCount(linkId: string) {
        const { data, error } = await this.supabase.rpc('increment_download_count', { link_id: linkId });
        if (error) throw error;
        return data;
    }

    async updateTransferStatus(linkId: string, status: 'active' | 'completed' | 'expired') {
        const { error } = await this.supabase.from('file_transfers').update({ status }).eq('link_id', linkId);
        if (error) throw error;
    }

    async deleteFileTransfer(linkId: string) {
        if (!this.currentUser()) throw new Error('Utente non autenticato');

        const { error } = await this.supabase
            .rpc('delete_file_transfer', { p_link_id: linkId });

        if (error) throw error;
    }

    async restoreFileTransfer(linkId: string) {
        const userId = this.currentUser()?.id;
        if (!userId) throw new Error('Utente non autenticato');

        const { error } = await this.supabase
            .from('file_transfers')
            .update({ deleted_at: null })
            .eq('link_id', linkId)
            .eq('sender_id', userId);

        if (error) throw error;
    }

    async subscribeToSignaling(linkId: string, callback: (payload: any) => void): Promise<RealtimeChannel> {
        // Riusa un canale già sottoscritto se è ancora attivo
        const channel = this.signalingChannels.get(linkId);

        // lo stato interno di supabase-js
        const isReady = channel && (channel.state === 'joined' || channel.state === 'joining');

        if (isReady) {
            console.log(`Reusing existing channel for ${linkId}`);
            channel!.on('broadcast', { event: 'signal' }, (payload: any) => {
                callback(payload);
            });
            return channel!;
        }

        // Se il canale esistente non è pronto, rimuovilo per crearne uno nuovo
        if (channel) {
            this.signalingChannels.delete(linkId);
        }

        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 1500;

        const attempt = (retriesLeft: number): Promise<RealtimeChannel> => {
            return new Promise((resolve, reject) => {
                console.log(`Creating new signaling channel for ${linkId} (tentativi rimasti: ${retriesLeft})`);
                const newChannel = this.supabase.channel(`signaling:${linkId}`, {
                    config: {
                        broadcast: { self: false }
                    }
                });

                newChannel.on('broadcast', { event: 'signal' }, (payload: any) => {
                    callback(payload);
                });

                newChannel.subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        console.log(`Subscribed to signaling channel: signaling:${linkId}`);
                        this.signalingChannels.set(linkId, newChannel);
                        resolve(newChannel);
                    } else if (status === 'CHANNEL_ERROR') {
                        console.error(`Signaling channel error for ${linkId}`);
                        reject(new Error(`Failed to subscribe to signaling channel: ${status}`));
                    } else if (status === 'TIMED_OUT') {
                        console.warn(`Signaling channel timeout for ${linkId}, rimozione canale...`);
                        newChannel.unsubscribe();
                        if (retriesLeft > 0) {
                            console.log(`Retry signaling channel for ${linkId} tra ${RETRY_DELAY_MS}ms...`);
                            setTimeout(() => {
                                attempt(retriesLeft - 1).then(resolve).catch(reject);
                            }, RETRY_DELAY_MS);
                        } else {
                            reject(new Error(`Failed to subscribe to signaling channel: TIMED_OUT`));
                        }
                    }
                });
            });
        };

        return attempt(MAX_RETRIES);
    }

    async removeSignalingChannel(linkId: string) {
        const channel = this.signalingChannels.get(linkId);
        if (channel) {
            await channel.unsubscribe();
            this.signalingChannels.delete(linkId);
            console.log(`Channel removed for ${linkId}`);
        }
    }

    async sendSignal(linkId: string, signal: any) {
        // Usa il canale già sottoscritto per evitare fallback REST e warning
        let channel = this.signalingChannels.get(linkId);

        if (!channel) {
            // Se non c'è un canale, creiamolo e attendiamo la sottoscrizione prima di inviare
            channel = await this.subscribeToSignaling(linkId, () => {
            });
        }

        // Assicuriamoci che il canale sia nello stato corretto prima di inviare
        // @ts-ignore
        if (channel.state !== 'joined') {
            console.warn(`Channel for ${linkId} is in state ${channel.state}, waiting...`);
            await this.delay(200);
        }

        const response = await channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: signal
        });

        if (response !== 'ok') {
            console.error(`Failed to send signal to ${linkId}:`, response);
            // Fallback: se fallisce il broadcast, riprova una volta dopo breve delay
            await this.delay(500);
            await channel.send({ type: 'broadcast', event: 'signal', payload: signal });
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async addXP(points: number) {
        const userId = this.currentUser()?.id;
        if (!userId) return;
        const currentXP = this.currentProfile()?.xp_points || 0;
        return this.updateProfile({ xp_points: currentXP + points });
    }

    async incrementDailyFileCount() {
        const userId = this.currentUser()?.id;
        if (userId) {
            const { error } = await this.supabase.rpc('increment_daily_files', { user_id: userId });
            if (error) throw error;
            await this.loadUserProfile(userId);
        } else {
            const today = new Date().toDateString();
            const lastDate = localStorage.getItem(LAST_UPLOAD_DATE_KEY);
            let count = 0;
            if (lastDate === today) {
                count = parseInt(localStorage.getItem(ANON_DAILY_COUNT_KEY) || '0', 10);
            }
            localStorage.setItem(LAST_UPLOAD_DATE_KEY, today);
            localStorage.setItem(ANON_DAILY_COUNT_KEY, (count + 1).toString());
        }
    }

    isAuthenticated(): boolean {
        return this.currentUser() !== null;
    }

    isPremium(): boolean {
        return this.currentProfile()?.tier === 'premium';
    }

    canUploadToday(): boolean {
        if (this.isPremium()) return true;

        const userId = this.currentUser()?.id;
        if (userId) {
            const dailyCount = this.currentProfile()?.daily_files_count || 0;
            return dailyCount < environment.limits.free.maxFilesPerDay;
        } else {
            const today = new Date().toDateString();
            const lastDate = localStorage.getItem(LAST_UPLOAD_DATE_KEY);
            if (lastDate !== today) return true;
            const count = parseInt(localStorage.getItem(ANON_DAILY_COUNT_KEY) || '0', 10);
            return count < environment.limits.free.maxFilesPerDay;
        }
    }
}
