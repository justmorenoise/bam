import { Routes } from '@angular/router';
import { authGuard, electronPremiumGuard, maintenanceGuard } from '@core/guards/auth.guard';
import { langResolverFor } from '@core/guards/lang-route.resolver';
import { langRedirectGuard } from '@core/guards/lang-redirect.guard';

export const routes: Routes = [
    {
        path: 'coming-soon',
        loadComponent: () => import('./features/pages/components/maintenance/maintenance.component').then(m => m.MaintenanceComponent),
    },
    {
        path: '',
        loadComponent: () => import('./features/file-transfer/components/home/home.component').then(m => m.HomeComponent),
        canActivate: [maintenanceGuard, electronPremiumGuard, langRedirectGuard('')],
    },
    {
        path: 'upload',
        loadComponent: () => import('./features/file-transfer/components/upload/upload.component').then(m => m.UploadComponent),
        canActivate: [maintenanceGuard, electronPremiumGuard],
    },
    {
        path: 'download/:linkId',
        loadComponent: () => import('./features/file-transfer/components/download/download.component').then(m => m.DownloadComponent),
        canActivate: [maintenanceGuard],
    },
    {
        path: 'auth',
        canActivate: [maintenanceGuard],
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
            {
                path: 'forgot-password',
                loadComponent: () => import('./features/auth/components/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
            },
            {
                path: 'reset-password',
                loadComponent: () => import('./features/auth/components/reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
            },
        ]
    },
    {
        path: 'electron-gate',
        loadComponent: () => import('./features/pages/components/electron-gate/electron-gate.component').then(m => m.ElectronGateComponent),
        canActivate: [maintenanceGuard, authGuard],
    },
    {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/components/dashboard/dashboard.component').then(m => m.DashboardComponent),
        canActivate: [maintenanceGuard, authGuard, electronPremiumGuard],
    },
    {
        path: 'settings',
        loadComponent: () => import('./features/dashboard/components/settings/settings.component').then(m => m.SettingsComponent),
        canActivate: [maintenanceGuard, authGuard, electronPremiumGuard],
    },
    {
        path: 'terms',
        loadComponent: () => import('./features/pages/components/terms/terms.component').then(m => m.TermsComponent),
        canActivate: [maintenanceGuard, langRedirectGuard('terms')],
    },
    {
        path: 'privacy',
        loadComponent: () => import('./features/pages/components/privacy/privacy.component').then(m => m.PrivacyComponent),
        canActivate: [maintenanceGuard, langRedirectGuard('privacy')],
    },
    {
        path: 'about',
        loadComponent: () => import('./features/pages/components/about/about.component').then(m => m.AboutComponent),
        canActivate: [maintenanceGuard, langRedirectGuard('about')],
    },
    {
        path: 'security',
        loadComponent: () => import('./features/pages/components/security/security.component').then(m => m.SecurityComponent),
        canActivate: [maintenanceGuard, langRedirectGuard('security')],
    },
    {
        path: 'pricing',
        loadComponent: () => import('./features/pages/components/pricing/pricing.component').then(m => m.PricingComponent),
        canActivate: [maintenanceGuard, langRedirectGuard('pricing')],
    },
    {
        path: 'en',
        children: [
            { path: '',         loadComponent: () => import('./features/file-transfer/components/home/home.component').then(m => m.HomeComponent),    resolve: { _: langResolverFor('en') } },
            { path: 'about',    loadComponent: () => import('./features/pages/components/about/about.component').then(m => m.AboutComponent),    resolve: { _: langResolverFor('en') } },
            { path: 'security', loadComponent: () => import('./features/pages/components/security/security.component').then(m => m.SecurityComponent), resolve: { _: langResolverFor('en') } },
            { path: 'pricing',  loadComponent: () => import('./features/pages/components/pricing/pricing.component').then(m => m.PricingComponent),  resolve: { _: langResolverFor('en') } },
            { path: 'terms',    loadComponent: () => import('./features/pages/components/terms/terms.component').then(m => m.TermsComponent),    resolve: { _: langResolverFor('en') } },
            { path: 'privacy',  loadComponent: () => import('./features/pages/components/privacy/privacy.component').then(m => m.PrivacyComponent),  resolve: { _: langResolverFor('en') } },
        ],
    },
    {
        path: 'it',
        children: [
            { path: '',         loadComponent: () => import('./features/file-transfer/components/home/home.component').then(m => m.HomeComponent),    resolve: { _: langResolverFor('it') } },
            { path: 'about',    loadComponent: () => import('./features/pages/components/about/about.component').then(m => m.AboutComponent),    resolve: { _: langResolverFor('it') } },
            { path: 'security', loadComponent: () => import('./features/pages/components/security/security.component').then(m => m.SecurityComponent), resolve: { _: langResolverFor('it') } },
            { path: 'pricing',  loadComponent: () => import('./features/pages/components/pricing/pricing.component').then(m => m.PricingComponent),  resolve: { _: langResolverFor('it') } },
            { path: 'terms',    loadComponent: () => import('./features/pages/components/terms/terms.component').then(m => m.TermsComponent),    resolve: { _: langResolverFor('it') } },
            { path: 'privacy',  loadComponent: () => import('./features/pages/components/privacy/privacy.component').then(m => m.PrivacyComponent),  resolve: { _: langResolverFor('it') } },
        ],
    },
    {
        path: '**',
        redirectTo: '',
    },
];
