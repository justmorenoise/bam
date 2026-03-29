import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface HnStory {
    title: string;
    url: string;
    score: number;
    comments: number;
    author: string;
}

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const CACHE_TTL_MS = 10 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class HnNewsService {
    private http = inject(HttpClient);

    private cachedAt = 0;
    private cache: HnStory[] = [];

    async getTopStories(n = 3): Promise<HnStory[]> {
        if (this.cache.length && Date.now() - this.cachedAt < CACHE_TTL_MS) {
            return this.cache.slice(0, n);
        }

        try {
            const ids = await firstValueFrom(
                this.http.get<number[]>(`${HN_BASE}/topstories.json`)
            );
            const topIds = ids.slice(0, n);
            const stories = await Promise.all(
                topIds.map(id =>
                    firstValueFrom(
                        this.http.get<{ title: string; url?: string; score: number; descendants?: number; by: string }>(
                            `${HN_BASE}/item/${id}.json`
                        )
                    )
                )
            );
            this.cache = stories
                .filter(s => s && s.title && s.url)
                .map(s => ({
                    title: s.title,
                    url: s.url!,
                    score: s.score ?? 0,
                    comments: s.descendants ?? 0,
                    author: s.by,
                }));
            this.cachedAt = Date.now();
            return this.cache.slice(0, n);
        } catch {
            return [];
        }
    }
}
