import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';

export interface ReceiptData {
    fileName: string;
    fileSize: number;
    fileHash: string;
    mode: 'burn' | 'seed';
    senderEmail?: string;
    receiverEmail?: string;
    transferStartedAt: Date;
    transferCompletedAt: Date;
    transferSpeed: number; // bytes/sec
    passwordProtected: boolean;
    linkId: string;
}

@Injectable({
    providedIn: 'root'
})
export class ReceiptService {

    /**
     * Genera una ricevuta PDF per un trasferimento completato
     */
    generateReceipt(data: ReceiptData): Blob {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        let y = 20;

        // Header
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('BAM', pageWidth / 2, y, { align: 'center' });
        y += 8;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('P2P File Sharing — Ricevuta di Consegna', pageWidth / 2, y, { align: 'center' });
        y += 15;

        // Linea separatrice
        doc.setDrawColor(200, 200, 200);
        doc.line(20, y, pageWidth - 20, y);
        y += 12;

        // Dettagli trasferimento
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Dettagli Trasferimento', 20, y);
        y += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        const addField = (label: string, value: string) => {
            doc.setFont('helvetica', 'bold');
            doc.text(label + ':', 20, y);
            doc.setFont('helvetica', 'normal');
            doc.text(value, 80, y);
            y += 7;
        };

        addField('File', data.fileName);
        addField('Dimensione', this.formatFileSize(data.fileSize));
        addField('Hash SHA-256', data.fileHash.substring(0, 32) + '...');
        addField('Modalità', data.mode === 'burn' ? 'Usa e Getta (burn)' : 'Persistente (seed)');
        addField('Protetto', data.passwordProtected ? 'Sì (AES-GCM 256-bit)' : 'No');
        addField('Link ID', data.linkId);

        y += 5;

        // Timing
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Tempistiche', 20, y);
        y += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        addField('Inizio', this.formatDate(data.transferStartedAt));
        addField('Fine', this.formatDate(data.transferCompletedAt));

        const durationSec = (data.transferCompletedAt.getTime() - data.transferStartedAt.getTime()) / 1000;
        addField('Durata', this.formatDuration(durationSec));
        addField('Velocità media', this.formatFileSize(data.transferSpeed) + '/s');

        y += 5;

        // Partecipanti
        if (data.senderEmail || data.receiverEmail) {
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('Partecipanti', 20, y);
            y += 10;

            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');

            if (data.senderEmail) addField('Mittente', data.senderEmail);
            if (data.receiverEmail) addField('Destinatario', data.receiverEmail);
            y += 5;
        }

        // Sicurezza
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Sicurezza', 20, y);
        y += 10;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);

        const securityNotes = [
            'Trasferimento diretto P2P via WebRTC — nessun server intermedio.',
            'Crittografia E2E nativa tramite DTLS 1.2+.',
            'Integrità verificata tramite hash SHA-256.',
        ];

        if (data.passwordProtected) {
            securityNotes.push('Protezione aggiuntiva AES-GCM 256-bit con PBKDF2 (100.000 iterazioni).');
        }

        securityNotes.forEach(note => {
            doc.text('• ' + note, 20, y);
            y += 6;
        });

        y += 10;

        // Footer
        doc.setDrawColor(200, 200, 200);
        doc.line(20, y, pageWidth - 20, y);
        y += 8;

        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
            `Generato da BAM P2P File Sharing — ${this.formatDate(new Date())}`,
            pageWidth / 2,
            y,
            { align: 'center' }
        );
        y += 5;
        doc.text(
            'Questo documento certifica che il trasferimento è avvenuto con successo.',
            pageWidth / 2,
            y,
            { align: 'center' }
        );

        return doc.output('blob');
    }

    /**
     * Genera e scarica la ricevuta PDF
     */
    downloadReceipt(data: ReceiptData): void {
        const blob = this.generateReceipt(data);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bam-ricevuta-${data.linkId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    private formatDate(date: Date): string {
        return date.toLocaleString('it-IT', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }

    private formatDuration(seconds: number): string {
        if (seconds < 1) return '<1 secondo';
        if (seconds < 60) return `${Math.round(seconds)} secondi`;
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${minutes}m ${secs}s`;
    }
}
