import { Injectable, signal } from '@angular/core';
import { environment } from '@environments/environment';
import { getChunkSize, getMaxChannels, isSafari, TRANSFER_CONFIG } from './transfer.config';
import { AdaptiveParams, ConnectionProfile, ConnectionType } from './transfer.types';

@Injectable({ providedIn: 'root' })
export class ConnectionService {
    readonly connectionState = signal<RTCPeerConnectionState>('new');
    readonly connectionProfile = signal<ConnectionProfile | null>(null);

    createPeerConnection(): RTCPeerConnection {
        const pc = new RTCPeerConnection({
            iceServers: environment.webrtc.iceServers,
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
        });

        pc.onconnectionstatechange = () => {
            console.log(`🧪 [PC-STATE] ${pc.connectionState}`);
            this.connectionState.set(pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                console.error(`🧪 [PC-STATE] Connection ${pc.connectionState} - ICE state: ${pc.iceConnectionState}`);
            }
        };

        return pc;
    }

    async createOffer(pc: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        return offer;
    }

    async createAnswer(pc: RTCPeerConnection, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        return answer;
    }

    async setRemoteAnswer(pc: RTCPeerConnection, answer: RTCSessionDescriptionInit): Promise<void> {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    async addIceCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('addIceCandidate failed:', err);
        }
    }

    hasRemoteDescription(pc: RTCPeerConnection): boolean {
        return pc.remoteDescription !== null;
    }

    // ─── Connection Profiling ────────────────────────────────

    async profileConnection(pc: RTCPeerConnection): Promise<ConnectionProfile> {
        const stats = await pc.getStats();
        let rttMs = 50;
        let localCandidateType = 'unknown';
        let remoteCandidateType = 'unknown';
        let availableBitrate = 0;

        const localCandidates = new Map<string, RTCStatsReport>();
        const remoteCandidates = new Map<string, RTCStatsReport>();

        stats.forEach((report: any) => {
            if (report.type === 'local-candidate') {
                localCandidates.set(report.id, report);
            } else if (report.type === 'remote-candidate') {
                remoteCandidates.set(report.id, report);
            }
        });

        stats.forEach((report: any) => {
            if (report.type === 'candidate-pair' && report.nominated) {
                if (report.currentRoundTripTime !== undefined) {
                    rttMs = report.currentRoundTripTime * 1000;
                }
                if (report.availableOutgoingBitrate !== undefined) {
                    availableBitrate = report.availableOutgoingBitrate;
                }
                const local = localCandidates.get(report.localCandidateId) as any;
                const remote = remoteCandidates.get(report.remoteCandidateId) as any;
                if (local?.candidateType) localCandidateType = local.candidateType;
                if (remote?.candidateType) remoteCandidateType = remote.candidateType;
            }
        });

        const type = this.classifyConnection(localCandidateType, remoteCandidateType, rttMs);

        const profile: ConnectionProfile = {
            type,
            rttMs,
            availableBitrate,
            localCandidateType,
            remoteCandidateType,
        };

        this.connectionProfile.set(profile);
        return profile;
    }

    calculateAdaptiveParams(profile: ConnectionProfile): AdaptiveParams {
        const safari = isSafari();

        if (safari) {
            return {
                chunkSize: TRANSFER_CONFIG.CHUNK_SIZE_SAFARI,
                maxBufferedAmount: TRANSFER_CONFIG.MAX_BUFFER_RELAY,
                channelCount: TRANSFER_CONFIG.MAX_CHANNELS_SAFARI,
                connectionProfile: profile,
            };
        }

        switch (profile.type) {
            case 'lan':
                return {
                    chunkSize: TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT,
                    maxBufferedAmount: TRANSFER_CONFIG.MAX_BUFFER_LAN,
                    channelCount: Math.min(6, getMaxChannels()),
                    connectionProfile: profile,
                };
            case 'wan':
                if (profile.rttMs <= 50) {
                    return {
                        chunkSize: TRANSFER_CONFIG.CHUNK_SIZE_DEFAULT,
                        maxBufferedAmount: TRANSFER_CONFIG.MAX_BUFFER_WAN,
                        channelCount: Math.min(4, getMaxChannels()),
                        connectionProfile: profile,
                    };
                }
                return {
                    chunkSize: 128 * 1024 - 64,
                    maxBufferedAmount: TRANSFER_CONFIG.MAX_BUFFER_RELAY,
                    channelCount: Math.min(3, getMaxChannels()),
                    connectionProfile: profile,
                };
            case 'relay':
                return {
                    chunkSize: 128 * 1024 - 64,
                    maxBufferedAmount: TRANSFER_CONFIG.MAX_BUFFER_RELAY,
                    channelCount: 2,
                    connectionProfile: profile,
                };
            default:
                return {
                    chunkSize: getChunkSize(),
                    maxBufferedAmount: TRANSFER_CONFIG.MAX_BUFFER_WAN,
                    channelCount: Math.min(3, getMaxChannels()),
                    connectionProfile: profile,
                };
        }
    }

    // ─── Stability Verification ──────────────────────────────

    async verifyStability(pc: RTCPeerConnection, durationMs?: number): Promise<boolean> {
        if (pc.connectionState !== 'connected') return false;

        const duration = durationMs ?? TRANSFER_CONFIG.STABILITY_CHECK_DURATION;
        const interval = TRANSFER_CONFIG.STABILITY_CHECK_INTERVAL;
        const iterations = Math.ceil(duration / interval);
        const samples: number[] = [];

        for (let i = 0; i < iterations; i++) {
            const stats = await pc.getStats();
            stats.forEach((report: any) => {
                if (report.type === 'candidate-pair' && report.nominated && report.currentRoundTripTime !== undefined) {
                    samples.push(report.currentRoundTripTime * 1000);
                }
            });
            if (i < iterations - 1) {
                await this.delay(interval);
            }
        }

        if (samples.length < 2) return true;

        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        if (avg === 0) return true;

        const variance = samples.reduce((a, b) => a + (b - avg) ** 2, 0) / samples.length;
        const cv = Math.sqrt(variance) / avg;

        return cv < TRANSFER_CONFIG.STABILITY_MAX_CV;
    }

    waitForConnection(pc: RTCPeerConnection, timeoutMs?: number): Promise<void> {
        const timeout = timeoutMs ?? TRANSFER_CONFIG.CONNECTION_TIMEOUT;

        if (pc.connectionState === 'connected') return Promise.resolve();
        // Some browsers report 'completed' on iceConnectionState before connectionState becomes 'connected'
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return Promise.resolve();

        return new Promise((resolve, reject) => {
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error(`Connection timeout (connectionState: ${pc.connectionState}, iceConnectionState: ${pc.iceConnectionState}, signalingState: ${pc.signalingState})`));
            }, timeout);

            const cleanup = () => {
                clearTimeout(timer);
                pc.removeEventListener('connectionstatechange', onConnectionState);
                pc.removeEventListener('iceconnectionstatechange', onIceConnectionState);
            };

            const tryResolve = () => {
                if (settled) return;
                if (pc.connectionState === 'connected' ||
                    pc.iceConnectionState === 'connected' ||
                    pc.iceConnectionState === 'completed') {
                    settled = true;
                    cleanup();
                    resolve();
                }
            };

            const tryReject = () => {
                if (settled) return;
                if (pc.connectionState === 'failed' || pc.connectionState === 'closed' ||
                    pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                    settled = true;
                    cleanup();
                    reject(new Error(`Connection ${pc.connectionState} (ice: ${pc.iceConnectionState})`));
                }
            };

            const onConnectionState = () => {
                tryResolve();
                tryReject();
            };
            const onIceConnectionState = () => {
                tryResolve();
                tryReject();
            };

            pc.addEventListener('connectionstatechange', onConnectionState);
            pc.addEventListener('iceconnectionstatechange', onIceConnectionState);
        });
    }

    closePeerConnection(pc: RTCPeerConnection): void {
        pc.close();
        this.connectionState.set('closed');
        this.connectionProfile.set(null);
    }

    // ─── Private ─────────────────────────────────────────────

    private classifyConnection(localType: string, remoteType: string, rttMs: number): ConnectionType {
        if (localType === 'relay' || remoteType === 'relay') return 'relay';
        if (localType === 'host' && remoteType === 'host') return 'lan';
        if (localType === 'srflx' || remoteType === 'srflx') return 'wan';
        if (rttMs < 10) return 'lan';
        return 'wan';
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
