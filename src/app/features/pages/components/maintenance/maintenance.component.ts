import { Component } from '@angular/core';

@Component({
    selector: 'app-maintenance',
    standalone: true,
    template: `
        <div class="wrapper">
            <div class="logo">Bam!</div>

            <div class="card">
                <div class="icon">🔧</div>
                <h1>Stiamo lavorando</h1>
                <p>
                    Il servizio è temporaneamente sospeso per manutenzione.<br />
                    Torneremo operativi a breve.
                </p>
                <div class="status-wrap">
                    <span class="status">
                        <span class="dot"></span>
                        Manutenzione in corso
                    </span>
                </div>
            </div>

            <footer>bamfile.com</footer>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            min-height: 100dvh;
            background: #0a0a0a;
        }

        .wrapper {
            min-height: 100dvh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            gap: 2rem;
        }

        .logo {
            font-size: 3.5rem;
            font-weight: 800;
            letter-spacing: -2px;
            background: linear-gradient(135deg, #fff 30%, #888);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .card {
            background: #141414;
            border: 1px solid #222;
            border-radius: 1.25rem;
            padding: 2.5rem 3rem;
            max-width: 480px;
            width: 100%;
            text-align: center;
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .icon {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }

        h1 {
            font-size: 1.5rem;
            font-weight: 700;
            color: #fff;
        }

        p {
            font-size: 0.95rem;
            color: #888;
            line-height: 1.6;
        }

        .status-wrap {
            display: flex;
            justify-content: center;
        }

        .status {
            display: inline-flex;
            align-items: center;
            font-size: 0.8rem;
            color: #f59e0b;
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.2);
            border-radius: 999px;
            padding: 0.3rem 0.9rem;
            margin-top: 0.5rem;
        }

        .dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #f59e0b;
            margin-right: 6px;
            animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }

        footer {
            font-size: 0.75rem;
            color: #444;
        }
    `],
})
export class MaintenanceComponent {}
