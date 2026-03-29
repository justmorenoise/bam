import { Component, OnInit, signal, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { HnNewsService, HnStory } from '@core/services/hn-news.service';

@Component({
    selector: 'app-hn-news',
    standalone: true,
    imports: [TranslateModule],
    template: `
        @if (isLoading()) {
            <div class="mt-8">
                <p class="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-4">
                    {{ 'HN_NEWS.TITLE' | translate }}
                </p>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    @for (item of skeletons; track item) {
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 animate-pulse">
                            <div class="h-3 bg-slate-800 rounded mb-2 w-full"></div>
                            <div class="h-3 bg-slate-800 rounded mb-4 w-3/4"></div>
                            <div class="h-2 bg-slate-800 rounded w-1/2"></div>
                        </div>
                    }
                </div>
            </div>
        } @else if (stories().length > 0) {
            <div class="mt-8">
                <p class="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-4">
                    {{ 'HN_NEWS.TITLE' | translate }}
                </p>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    @for (story of stories(); track story.url) {
                        <a
                            [href]="story.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-600 hover:bg-slate-800/60 transition-all group flex flex-col gap-3 no-underline">
                            <p class="text-sm font-semibold text-slate-200 leading-snug group-hover:text-white line-clamp-3">
                                {{ story.title }}
                            </p>
                            <div class="flex items-center gap-3 text-[11px] text-slate-500 mt-auto">
                                <span>▲ {{ story.score }} {{ 'HN_NEWS.POINTS' | translate }}</span>
                                <span>💬 {{ story.comments }}</span>
                                <span class="ml-auto truncate">{{ story.author }}</span>
                            </div>
                        </a>
                    }
                </div>
            </div>
        }
    `,
})
export class HnNewsComponent implements OnInit {
    private hnNews = inject(HnNewsService);

    stories = signal<HnStory[]>([]);
    isLoading = signal(true);
    readonly skeletons = [1, 2, 3];

    async ngOnInit(): Promise<void> {
        const result = await this.hnNews.getTopStories(3);
        this.stories.set(result);
        this.isLoading.set(false);
    }
}
