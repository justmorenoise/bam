# **Progetto Bam: P2P File Sharing Ecosystem**

**Bam** è un'applicazione di trasferimento file Peer-to-Peer (P2P) ad alte prestazioni che combina la semplicità di una web-app con la potenza di un'integrazione nativa desktop. Elimina la necessità di caricare file su server cloud, garantendo privacy, velocità e controllo totale.

## **1\. Caratteristiche Principali**

### **Core Technology**

* **Trasferimento P2P (WebRTC):** Connessione diretta tra mittente e destinatario via DTLS/SRTP.  
* **Desktop Agent (Electron):** App residente in background per gestire il seeding tramite Node.js.  
* **Integrazione OS:** Opzione "Condividi con Bam" nel menu contestuale (tasto destro) di Windows e macOS.  
* **Signaling Realtime (Supabase):** Gestione degli handshake e notifiche istantanee tramite PostgreSQL e Broadcast.  
* **Supporto Multilingue (i18n):** Gestione tramite file JSON e @ngx-translate/core.

### **Sicurezza e Privacy**

* **Crittografia End-to-End Nativa:** WebRTC cifra i flussi di dati di default (DTLS 1.2+). Tutti i trasferimenti sono protetti.  
* **Cifratura Password-Based Premium (Web Crypto API):** Per gli utenti Premium, i file vengono cifrati simmetricamente (AES-GCM) prima della trasmissione. Chiave derivata tramite PBKDF2.  
* **Verifica Integrità (Hash SHA-256):** Ricalcolo dell'impronta digitale lato destinatario per garantire l'assenza di manomissioni.  
* **Modalità Burn-on-Read:** Il link scade dopo il primo download completato.  
* **Modalità Seeding:** Condivisione persistente per download multipli.

## **2\. Funzionalità Avanzate di Usabilità**

* **Resume Intelligente:** Gestione dei checkpoint per riprendere i download interrotti.  
* **QR Quick-Share:** Generazione di codici QR dinamici per il trasferimento Desktop-to-Mobile.  
* **Drag-and-Drop Systray:** Integrazione con la tray icon di Electron per generare link rapidi via trascinamento.

## **3\. Tipologie di Utenti**

### **Utente Anonimo (Guest)**

* **Identità:** "Utente Anonimo".  
* **Pubblicità:** Sempre attiva.

### **Utente Registrato (Pro Free / Pro Premium)**

* **Pro Free:** Metriche base, gamification, pubblicità.  
* **Pro Premium:** Tutte le funzioni avanzate, file illimitati, zero pubblicità.

## **5\. User Journey: Il Mittente**

### **Flusso Free Web**

1. **Azione:** Sfoglia o trascina un file nella schermata di upload.
2. **Tipo:** Scegliere se creare un link usa e getta o persistente.
3. **Stato:** Monitoraggio del processo di upload e download con messaggi e progress bar.
4. **Supporto:** Gestione di file di grandi dimensioni.

### **Flusso Premium**

1. **Azione:** Tasto destro sul file \-\> "Condividi con Bam".  
2. **Configurazione:** Impostazione password (trigger Web Crypto API), URL custom e modalità.  
3. **Cifratura:** Il servizio Angular dedicato processa il file localmente tramite l'agente Electron.  
4. **Notifiche:** Push su desktop all'inizio e alla fine del download.

## **6\. User Journey: Il Destinatario**

1. **Atterraggio:** Inserimento password (se prevista dal mittente Premium).  
2. **Decifratura:** La Web Crypto API decifra il flusso di dati in tempo reale direttamente nel browser.  
3. **Verifica:** Controllo Hash SHA-256 e salvataggio locale.
4. **Download:** Progress del download e messaggio di stato e o errore.
5. **Riprendi:** Resume del download (Premium).

## **7\. Matrice delle Funzionalità**

| Funzionalità | Anonimo | Pro Free | Pro Premium |
| :---- | :---- | :---- | :---- |
| **P2P Illimitato (Dimensione)** | Sì | Sì | Sì |
| **Cifratura End-to-End (E2EE)** | **Sì (Nativa)** | **Sì (Nativa)** | **Sì (Nativa)** |
| **Cifratura Password-Based** | No | No | **Sì (Web Crypto)** |
| **Limite File Giornalieri** | 5 | 5 | **Illimitati** |
| **Pubblicità** | Sì | Sì | No |
| **Verifica Integrità (Hash)** | Sì | Sì | Sì |
| **URL Personalizzati** | No | No | Sì |
| **Resume Download** | No | Sì | Sì |

## **8\. Stack Tecnologico**

* **Frontend:** **Angular 20+** (Signals, Standalone Components).  
* **Styling:** Tailwind CSS.  
* **Internazionalizzazione:** @ngx-translate/core.  
* **Sicurezza:** Web Crypto API (AES-GCM, PBKDF2).  
* **Desktop:** Electron.  
* **Backend:** Supabase (Auth, Firestore-like Database, Realtime).  
* **Ads:** Google AdSense.
* **P2P:** WebRTC.
