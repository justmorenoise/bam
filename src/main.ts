import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { VERSION } from './version';
import { environment } from '@environments/environment';

// Log versione in console
console.log(
    `%c🚀 ${environment.appName}`,
    'color: #4F46E5; font-size: 20px; font-weight: bold;'
);
console.log(
    `%cVersion: ${VERSION.version} (Build #${VERSION.buildNumber})`,
    'color: #10B981; font-size: 14px; font-weight: bold;'
);
console.log(
    `%cBuild Date: ${new Date(VERSION.buildDate).toLocaleString()}`,
    'color: #6B7280; font-size: 12px;'
);
console.log(
    `%cEnvironment: ${environment.production ? 'Production' : 'Development'}`,
    `color: ${environment.production ? '#EF4444' : '#F59E0B'}; font-size: 12px; font-weight: bold;`
);

bootstrapApplication(AppComponent, appConfig)
    .catch((err) => console.error(err));
