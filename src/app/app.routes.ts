import { Routes } from '@angular/router';
import { authGuard, electronPremiumGuard, maintenanceGuard } from '@core/guards/auth.guard';

export const routes: Routes = [
    {
        path: 'coming-soon',
        loadComponent: () => import('./features/pages/components/maintenance/maintenance.component').then(m => m.MaintenanceComponent),
    },
    {
        path: '',
        loadComponent: () => import('./features/file-transfer/components/home/home.component').then(m => m.HomeComponent),
        canActivate: [maintenanceGuard, electronPremiumGuard],
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
        canActivate: [maintenanceGuard],
    },
    {
        path: 'privacy',
        loadComponent: () => import('./features/pages/components/privacy/privacy.component').then(m => m.PrivacyComponent),
        canActivate: [maintenanceGuard],
    },
    {
        path: 'about',
        loadComponent: () => import('./features/pages/components/about/about.component').then(m => m.AboutComponent),
        canActivate: [maintenanceGuard],
    },
    {
        path: 'security',
        loadComponent: () => import('./features/pages/components/security/security.component').then(m => m.SecurityComponent),
        canActivate: [maintenanceGuard],
    },
    {
        path: 'pricing',
        loadComponent: () => import('./features/pages/components/pricing/pricing.component').then(m => m.PricingComponent),
        canActivate: [maintenanceGuard],
    },
    {
        path: '**',
        redirectTo: '',
    },
];
