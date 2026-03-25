import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@environments/environment';

@Injectable({ providedIn: 'root' })
export class TurnService {

    private readonly apiUrl = `${environment.webrtc.turnServiceApiUrl}?apiKey=${environment.webrtc.turnServiceApiKey}`;
    private cachedIceServers: RTCIceServer[] | null = null;
    private cacheExpiry: number = 0;

    constructor(private http: HttpClient) {
    }

    async getIceServers(): Promise<RTCIceServer[]> {
        // Cache per 1 ora
        if (this.cachedIceServers && Date.now() < this.cacheExpiry) {
            return this.cachedIceServers;
        }

        try {
            const servers = await firstValueFrom(
                this.http.get<RTCIceServer[]>(this.apiUrl)
            );
            this.cachedIceServers = servers;
            this.cacheExpiry = Date.now() + 60 * 60 * 1000; // 1 ora
            return servers;
        } catch (error) {
            console.warn('TURN fetch failed, falling back to STUN only', error);
            return environment.webrtc.iceServers;
        }
    }
}
