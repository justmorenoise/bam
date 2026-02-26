import { Routes } from '@angular/router';
import { authGuard, electronPremiumGuard } from '@core/guards/auth.guard';

export const routes: Routes = [
    {
        path: '',
        loadComponent: () => import('./features/file-transfer/components/home/home.component').then(m => m.HomeComponent),
        canActivate: [electronPremiumGuard],
    },
    {
        path: 'upload',
        loadComponent: () => import('./features/file-transfer/components/upload/upload.component').then(m => m.UploadComponent),
        canActivate: [electronPremiumGuard],
    },
    {
        path: 'download/:linkId',
        loadComponent: () => import('./features/file-transfer/components/download/download.component').then(m => m.DownloadComponent),
    },
    {
        path: 'auth',
        children: [
            {
                path: 'login',
                loadComponent: () => import('./features/auth/components/login/login.component').then(m => m.LoginComponent),
            },
            {
                path: 'register',
                loadComponent: () => import('./features/auth/components/register/register.component').then(m => m.RegisterComponent),
            },
            {
                path: 'callback',
                loadComponent: () => import('./features/auth/components/callback/callback.component').then(m => m.CallbackComponent),
            },
        ]
    },
    {
        path: 'electron-gate',
        loadComponent: () => import('./features/pages/components/electron-gate/electron-gate.component').then(m => m.ElectronGateComponent),
        canActivate: [authGuard],
    },
    {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/components/dashboard/dashboard.component').then(m => m.DashboardComponent),
        canActivate: [authGuard, electronPremiumGuard],
    },
    {
        path: 'settings',
        loadComponent: () => import('./features/dashboard/components/settings/settings.component').then(m => m.SettingsComponent),
        canActivate: [authGuard, electronPremiumGuard],
    },
    {
        path: 'terms',
        loadComponent: () => import('./features/pages/components/terms/terms.component').then(m => m.TermsComponent),
    },
    {
        path: 'privacy',
        loadComponent: () => import('./features/pages/components/privacy/privacy.component').then(m => m.PrivacyComponent),
    },
    {
        path: 'about',
        loadComponent: () => import('./features/pages/components/about/about.component').then(m => m.AboutComponent),
    },
    {
        path: 'security',
        loadComponent: () => import('./features/pages/components/security/security.component').then(m => m.SecurityComponent),
    },
    {
        path: 'pricing',
        loadComponent: () => import('./features/pages/components/pricing/pricing.component').then(m => m.PricingComponent),
    },
    {
        path: '**',
        redirectTo: '',
    },
];
