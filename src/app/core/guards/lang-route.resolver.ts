import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { LanguageService } from '../services/language.service';

export const langResolverFor = (lang: 'en' | 'it'): ResolveFn<string> =>
    () => {
        inject(LanguageService).setLanguage(lang);
        return lang;
    };
