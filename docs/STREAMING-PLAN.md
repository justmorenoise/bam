# Piano Implementazione: Streaming Multimediale P2P

> Versione: 1.0 — 2026-02-28

---

## Indice

1. [Panoramica e obiettivo](#1-panoramica-e-obiettivo)
2. [Architettura tecnica scelta](#2-architettura-tecnica-scelta)
3. [Cosa viene riutilizzato](#3-cosa-viene-riutilizzato)
4. [Struttura dei nuovi file](#4-struttura-dei-nuovi-file)
5. [Protocollo di streaming sul DataChannel](#5-protocollo-di-streaming-sul-datachannel)
6. [Fasi di implementazione](#6-fasi-di-implementazione)
7. [Problemi noti e limitazioni](#7-problemi-noti-e-limitazioni)
8. [Costi aggiuntivi](#8-costi-aggiuntivi)
9. [Stima dello sforzo](#9-stima-dello-sforzo)

---

## 1. Panoramica e obiettivo

Quando l'utente trascina un file multimediale (`.mp4`, `.mp3`, `.webm`, `.mov`, ecc.),
oltre al pulsante di trasferimento normale appare un nuovo pulsante **"Stream"**.

Se il sender sceglie "Stream":
- Il receiver **non scarica** il file — gli viene mostrato un **player** con Play/Pause e timeline
- Lo streaming avviene P2P (stesso WebRTC già usato per i file), senza server intermedio
- Il receiver può **fare scrubbing** della timeline (seek), il sender reagisce e invia i dati dal punto richiesto
- La modalità funziona sia per video (con immagine) sia per solo audio

---

## 2. Architettura tecnica scelta

### Approccio: DataChannel + MediaSource API

Esistono due tecniche WebRTC per lo streaming:

| Tecnica | Pro | Contro |
|---|---|---|
| **RTCRtpSender** (media tracks) | Semplice, latency bassa | Nessun seeking, browser ri-codifica il video, qualità variabile |
| **DataChannel + MediaSource API** ✅ | Seeking reale, qualità originale, riusa l'infrastruttura esistente | Più complesso, MediaSource limitato su iOS |

**Scelta: DataChannel + MediaSource API** perché:
- Il seeking richiede un protocollo request/response tra receiver e sender (non possibile con RTCRtpSender)
- Non degrada la qualità (inviamo i byte originali, nessuna ri-codifica)
- Riutilizza quasi tutto il codice esistente (ConnectionService, TurnService, Signaling)

### Flusso complessivo

```
SENDER                                    RECEIVER
  │                                          │
  │  File MP4/MP3 sul disco                  │  Browser con <video> element
  │                                          │
  │  StreamingEngineService                  │  StreamingPlayerComponent
  │  ├─ Legge file a slice (File.slice())    │  ├─ MediaSource API
  │  ├─ Invia chunk su DataChannel           │  ├─ SourceBuffer (appende chunk)
  │  └─ Ascolta richieste seek               │  └─ Invia seek request → sender
  │                                          │
  └──────────── WebRTC DataChannel ──────────┘
```

---

## 3. Cosa viene riutilizzato

| Modulo esistente | Come viene riutilizzato |
|---|---|
| `ConnectionService` | Identico — crea PeerConnection, offer/answer, ICE |
| `TurnService` | Identico — recupera ICE servers |
| `SignalingService` (Supabase) | Identico per signaling, aggiunto tipo `stream` nel DB |
| `ParallelConnectionPoolService` | Non usato per streaming (1 PC, 1 DC è sufficiente) |
| `UploadStateService` | Esteso con `streamingMode` signal |
| `DownloadComponent` | Esteso: rileva `transfer_type === 'stream'` → mostra player invece del download |
| Tailwind CSS + design system | Identici |

---

## 4. Struttura dei nuovi file

```
src/app/
├── core/
│   └── services/
│       └── streaming/
│           ├── streaming-engine.service.ts       ← NUOVO: sender engine
│           ├── media-source.service.ts           ← NUOVO: receiver MediaSource wrapper
│           ├── stream-detector.service.ts        ← NUOVO: rileva se file è streamabile
│           └── streaming.types.ts                ← NUOVO: tipi condivisi
│
└── features/
    └── file-transfer/
        └── components/
            ├── upload/
            │   └── upload.component.ts/.html     ← MODIFICA: aggiunge pulsante "Stream"
            └── download/
                ├── download.component.ts/.html   ← MODIFICA: fork UI per stream vs file
                └── streaming-player/             ← NUOVO
                    ├── streaming-player.component.ts
                    └── streaming-player.component.html
```

### Modifica DB Supabase

Aggiungere colonna alla tabella `file_transfers`:

```sql
ALTER TABLE file_transfers
  ADD COLUMN transfer_type TEXT NOT NULL DEFAULT 'file'
  CHECK (transfer_type IN ('file', 'stream'));

-- Aggiungere indice (opzionale, per query per tipo)
CREATE INDEX idx_file_transfers_type ON file_transfers(transfer_type);
```

Il `DownloadComponent` legge `session.transferType` e decide quale UI mostrare.

---

## 5. Protocollo di streaming sul DataChannel

Il DataChannel è singolo, ordered (affidabile). I messaggi di controllo sono JSON (stringa),
i chunk dati sono ArrayBuffer (binario), stesso formato del file transfer attuale.

### Header chunk streaming

```
[4 byte: offset_high] [4 byte: offset_low] [payload...]
```

L'offset è a 64-bit (split in two 32-bit words) per supportare file >4GB.

### Messaggi di controllo (JSON, sender → receiver)

```typescript
// Il sender ha metadata pronti, receiver può creare il player
{ type: 'stream-metadata', mimeType: string, size: number,
  duration: number | null, hasVideo: boolean, hasAudio: boolean,
  isFastStart: boolean }  // isFastStart: false = warning al receiver

// Inizio segmento dati (seguito da chunk binari)
{ type: 'stream-segment-start', offset: number, length: number }

// Fine del segmento corrente (seek o EOF)
{ type: 'stream-segment-end', offset: number }

// Sender in pausa (buffer receiver pieno)
{ type: 'stream-pause' }

// Sender ha ripreso
{ type: 'stream-resume' }
```

### Messaggi di controllo (JSON, receiver → sender)

```typescript
// Receiver è pronto a ricevere
{ type: 'stream-ready' }

// Receiver richiede dati da un certo offset (seek)
{ type: 'stream-seek', offset: number, timeSeconds: number }

// Receiver vuole che il sender rallenti (buffer quasi pieno)
{ type: 'stream-throttle' }

// Receiver vuole che il sender riprenda
{ type: 'stream-continue' }
```

---

## 6. Fasi di implementazione

### Fase 1 — Rilevamento file e scelta UI (Sender)
**File modificati**: `stream-detector.service.ts` (NUOVO), `upload.component.ts/.html`

**Cosa fa `StreamDetectorService`**:
```typescript
readonly STREAMABLE_TYPES: Record<string, { hasVideo: boolean; hasAudio: boolean }> = {
  'video/mp4':       { hasVideo: true,  hasAudio: true  },
  'video/webm':      { hasVideo: true,  hasAudio: true  },
  'video/ogg':       { hasVideo: true,  hasAudio: true  },
  'video/quicktime': { hasVideo: true,  hasAudio: true  }, // .mov
  'video/mpeg':      { hasVideo: true,  hasAudio: true  }, // .mpg
  'audio/mpeg':      { hasVideo: false, hasAudio: true  }, // .mp3
  'audio/mp4':       { hasVideo: false, hasAudio: true  }, // .m4a
  'audio/ogg':       { hasVideo: false, hasAudio: true  }, // .ogg audio
  'audio/wav':       { hasVideo: false, hasAudio: true  },
  'audio/webm':      { hasVideo: false, hasAudio: true  },
};

isStreamable(file: File): boolean
getStreamInfo(file: File): { hasVideo: boolean; hasAudio: boolean } | null
isBrowserSupported(mimeType: string): boolean  // MediaSource.isTypeSupported()
```

**Modifica `upload.component.html`**: quando `isStreamable(selectedFile())` è true,
nel blocco "Stato B" (file selezionato, pre-link) appare un secondo pulsante:

```html
@if (streamDetector.isStreamable(selectedFile()!)) {
  <div class="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-2xl">
    <p class="text-sm font-bold text-purple-400 mb-3">
      Questo file può essere trasmesso in streaming
    </p>
    <div class="flex gap-3">
      <button (click)="generateLink()" class="btn btn-outline flex-1">
        Trasferisci file
      </button>
      <button (click)="generateStreamLink()" class="btn btn-primary flex-1">
        Streaming
      </button>
    </div>
  </div>
}
```

---

### Fase 2 — Sender engine streaming
**File nuovo**: `streaming-engine.service.ts`

Responsabilità:
- Crea PeerConnection via `ConnectionService` (identico al file transfer)
- Crea **un singolo DataChannel** ordered
- Legge il file con `File.slice(offset, offset + chunkSize)` + `FileReader` o `arrayBuffer()`
- Invia chunk sequenziali finché il buffer non è pieno (backpressure identico all'attuale)
- Ascolta messaggi `stream-seek` → salta all'offset richiesto, ricomincia a leggere
- Ascolta `stream-throttle` / `stream-continue` → pausa/riprende l'invio

```typescript
@Injectable({ providedIn: 'root' })
export class StreamingEngineService {
  readonly state = signal<StreamState>('idle');

  initStreaming(file: File): StreamingSession {
    // setup simile a initSenderLegacy() — 1 PC, 1 DC
    // ...
  }

  private async readAndSend(file: File, fromOffset: number): Promise<void> {
    let offset = fromOffset;
    while (offset < file.size && !this.cancelled && !this.throttled) {
      const slice = file.slice(offset, offset + STREAM_CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      await this.sendWithBackpressure(this.encodeChunk(offset, buffer));
      offset += buffer.byteLength;
    }
  }

  private handleSeek(offset: number): void {
    this.currentOffset = offset;
    // Interrompe lettura corrente, riparte da offset
    this.readAndSend(this.file, offset);
  }
}
```

---

### Fase 3 — Receiver: MediaSource Service
**File nuovo**: `media-source.service.ts`

Responsabilità:
- Crea `MediaSource` e lo collega a un `<video>` / `<audio>` element via `URL.createObjectURL`
- Riceve chunk binari → `sourceBuffer.appendBuffer()`
- Gestisce la coda di append (SourceBuffer è async, non accetta append consecutivi)
- Implementa buffer GC: rimuove segmenti già riprodotti per liberare memoria
- Gestisce seek del player → invia `stream-seek` al sender

```typescript
@Injectable({ providedIn: 'root' })
export class MediaSourceService {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private appendQueue: ArrayBuffer[] = [];
  private isAppending = false;

  attachToElement(videoEl: HTMLVideoElement, mimeType: string): void { ... }
  appendChunk(data: ArrayBuffer, offset: number): void { ... }
  onSeek(callback: (offset: number, timeSeconds: number) => void): void { ... }
  gcOldSegments(): void { ... }  // rimuove buffer già riprodotto
  dispose(): void { ... }
}
```

---

### Fase 4 — Receiver UI: StreamingPlayerComponent
**File nuovo**: `streaming-player/streaming-player.component.ts/.html`

UI elements:
- `<video>` o `<audio>` element con `autoplay`
- Barra di buffering (quanto è stato ricevuto, come YouTube)
- Play/Pause
- Timeline con scrubbing (input range o custom)
- Indicatore di qualità connessione (relay warning se RTT alto)
- Spinner di buffering quando i dati non arrivano abbastanza veloce

```html
<div class="streaming-player">
  <video #videoEl class="w-full rounded-xl" [class.hidden]="!hasVideo()"></video>
  <audio #audioEl [class.hidden]="hasVideo()"></audio>

  <!-- Buffer progress -->
  <div class="buffer-bar">
    <div class="buffered" [style.width.%]="bufferedPercent()"></div>
    <div class="played"   [style.width.%]="playedPercent()"></div>
    <input type="range" (change)="onSeek($event)" />
  </div>

  <!-- Controls -->
  <div class="controls">
    <button (click)="togglePlay()">▶/⏸</button>
    <span>{{ currentTime() | duration }} / {{ totalDuration() | duration }}</span>
  </div>

  <!-- Warning relay -->
  @if (isRelay() && rttMs() > 150) {
    <div class="relay-warning">
      ⚠️ Connessione relay (RTT: {{ rttMs() }}ms) — il buffering potrebbe essere lento
    </div>
  }
</div>
```

---

### Fase 5 — Modifica DownloadComponent
**File modificati**: `download.component.ts/.html`

Il componente già legge `session()` da DB. Aggiungere:

```typescript
// In loadFileInfo():
this.isStreamingSession = session.transferType === 'stream';
```

Nel template:
```html
@if (isStreamingSession()) {
  <!-- UI player al posto del download button -->
  <app-streaming-player [linkId]="linkId" />
} @else {
  <!-- UI download attuale, invariata -->
  ...download button, progress bar...
}
```

---

### Fase 6 — Modifiche SignalingService
Aggiungere metodi:

```typescript
async startStreamSession(file: File, mode: 'burn' | 'seed'): Promise<{ linkId: string }>
// Simile a startSenderSession() ma:
// - transfer_type = 'stream' nel DB
// - Usa StreamingEngineService invece di SenderEngineService
// - Non pre-calcola hash (non necessario per streaming)

receiveStream(linkId: string): Observable<StreamEvent>
// Simile a receiveFile() ma emette eventi di controllo player
```

---

## 7. Problemi noti e limitazioni

### 🔴 Critico

**MP4 senza fast-start (moov atom in fondo)**
- I video registrati da videocamera, GoPro, ecc. spesso hanno il blocco `moov` alla fine del file
- In questo caso, il browser non può iniziare la riproduzione finché non ha ricevuto abbastanza file da raggiungere il `moov`
- **Soluzione**: rilevare la posizione del `moov` leggendo i primi ~64KB del file (parsing box MP4). Se è in fondo, mostrare avviso all'utente: *"Questo video non è ottimizzato per lo streaming. La riproduzione potrebbe tardare ad iniziare."*
- Tool per correggere: `ffmpeg -i input.mp4 -movflags faststart output.mp4` (da suggerire all'utente)

**Seeking su TURN relay lento**
- Quando l'utente fa seek, il sender deve abbandonare il segmento corrente e inviare da un nuovo offset
- Se la connessione è relay a 0.5 MB/s, il rebuffering dopo un seek dura molti secondi
- **Non c'è soluzione** lato codice — dipende dalla banda del relay

### 🟡 Importante

**Codec support browser**
- `MediaSource.isTypeSupported()` varia tra browser. H.265/HEVC non supportato in Chrome. MKV non supportato.
- **Soluzione**: `StreamDetectorService.isBrowserSupported()` verifica prima di abilitare il pulsante Stream. Se il browser non supporta il codec, il pulsante è grigio con tooltip esplicativo.

**Seed mode + streaming**
- Con seed mode, più receiver possono connettersi in sequenza. Ma il sender ha un solo file aperto e una posizione di lettura corrente — ogni nuovo receiver ricomincia dall'inizio, e i seek di receiver diversi si conflittano.
- **Soluzione MVP**: disabilitare streaming in seed mode (solo burn mode).

**iOS Safari**
- MediaSource API è supportata da iOS 17.1+, ma con limitazioni (solo MP4/H.264, nessun WebM)
- Seeking potrebbe non funzionare su versioni < 17
- **Soluzione**: mostrare warning per iOS < 17; fallback al download normale

**Memoria SourceBuffer**
- Chrome limita il SourceBuffer a ~150MB di contenuto non riprodotto
- Per video lunghi si devono rimuovere i segmenti già riprodotti (`sourceBuffer.remove()`)
- Il GC va implementato con attenzione per non rimuovere dati ancora necessari al seek

### 🟢 Minori

**File `.mov` (QuickTime)**
- `video/quicktime` non è standard in MediaSource su tutti i browser
- Safari: ok. Chrome: problematico. **Soluzione**: trattare `.mov` come non supportato su Chrome

**File molto grandi (>2GB)**
- `File.slice()` funziona con file di qualsiasi dimensione
- Gli offset devono essere gestiti come `number` (JS float64 supporta interi fino a 2^53, ok per ~8PB)
- Nessun problema reale

**No hash verification per streaming**
- Nel file transfer l'integrità è verificata con xxHash128. Per streaming, i dati vengono riprodotti live — impossibile verificare prima della riproduzione.
- **Accettabile** per uso P2P tra utenti che si conoscono

---

## 8. Costi aggiuntivi

### TURN relay — l'impatto principale

Lo streaming consuma molta più banda del trasferimento file su relay, perché:
- L'utente guarda il video per ore (non scarica e finisce)
- I seek generano dati "sprecati" (il sender stava inviando dal minuto 10, l'utente salta al minuto 30 — i dati dal minuto 10 al 30 vengono scartati)

| Scenario | Banda relay consumata | Costo stimato Metered.ca (paid) |
|---|---|---|
| Film 2h, 2GB, nessun seek, P2P diretto | 0 | $0 |
| Film 2h, 2GB, nessun seek, su relay | ~2GB | ~$0.80 |
| Film 2h, 2GB, 5 seek, su relay | ~3-4GB (overshoot) | ~$1.20–1.60 |
| Musica 10 min, 10MB, su relay | ~10MB | <$0.01 |

**Piano free Metered.ca (500MB/mese)**: un solo film via relay esaurisce la quota mensile.

### Nessun costo aggiuntivo per

- Supabase: signaling aggiuntivo minimo (pochi messaggi JSON in più per seek)
- Server: tutto P2P, nessuna computazione server-side

### Raccomandazione

Aggiungere un **avviso visibile** nel player quando la connessione è relay:
> *"Stai trasmettendo via server relay. Il consumo di dati è elevato. Considera di passare alla modalità trasferimento file per connessioni lente."*

---

## 9. Stima dello sforzo

| Fase | Descrizione | Giorni |
|---|---|---|
| 1 | StreamDetectorService + UI sender (pulsante Stream) | 0.5 |
| 2 | StreamingEngineService (sender, lettura + seek) | 1.5 |
| 3 | MediaSourceService (receiver, SourceBuffer + GC) | 2 |
| 4 | StreamingPlayerComponent (UI player completa) | 1.5 |
| 5 | Modifiche DownloadComponent + SignalingService | 1 |
| 6 | Migrazione DB Supabase + test E2E | 0.5 |
| — | **Totale** | **~7 giorni** |

La maggior parte del rischio tecnico è nella **Fase 3** (MediaSource API) —
il comportamento varia sensibilmente tra browser, specialmente per il seeking.

---

## Appendice: formati supportati per browser

| Formato | Chrome | Firefox | Safari | iOS Safari |
|---|---|---|---|---|
| MP4 H.264+AAC | ✅ | ✅ | ✅ | ✅ |
| MP4 H.265/HEVC | ❌ | ❌ | ✅ | ✅ |
| WebM VP8/VP9 | ✅ | ✅ | ✅ (15.4+) | ⚠️ parziale |
| MP3 | ✅ | ✅ | ✅ | ✅ |
| AAC (.m4a) | ✅ | ✅ | ✅ | ✅ |
| OGG Vorbis | ✅ | ✅ | ❌ | ❌ |
| WAV | ✅ | ✅ | ✅ | ✅ |
| MKV | ❌ | ❌ | ❌ | ❌ |
| MOV | ❌ | ❌ | ✅ | ✅ |
| MPG/MPEG-2 | ❌ | ❌ | ❌ | ❌ |

> **MPG/MPEG-2**: nessun browser supporta MPEG-2 via MediaSource. Il pulsante "Stream" va disabilitato per questi file.
> **MKV**: non supportato da nessun browser via MSE. Stesso trattamento.
