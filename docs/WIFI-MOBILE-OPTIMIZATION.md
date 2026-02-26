# 📱 Ottimizzazione Connessioni WiFi ↔ Mobile

## Problema: Trasferimento Mac WiFi → Android 5G Lento

### Aspettative vs Realtà

**ASPETTATIVA (ERRATA)**:
```
Mac Fibra 1Gbps + Android 5G = 100+ MB/s
```

**REALTÀ**:
```
Velocità limitata dal link più lento (upload mobile)
Reti mobili italiane 5G: 20-50 Mbps upload medio
Velocità attesa: 2-6 MB/s (megabyte al secondo)
```

## 🔍 Diagnosi dalla Tua Connessione

Dal tuo log:
```
Local (Mac): srflx (188.228.176.215) - connessione attraverso STUN
Remote (Android): srflx (193.207.114.120) - connessione attraverso STUN
```

**Tipo connessione**: Server Reflexive (srflx ↔ srflx)
**Velocità teorica**: 10-30 MB/s
**Problema**: Carrier-grade NAT sulla rete mobile

## ⚡ Limitazioni Reti Mobile 5G

### Upload Reale in Italia

| Operatore | Download 5G | Upload 5G | Upload Reale |
|-----------|-------------|-----------|--------------|
| Vodafone | 200-500 Mbps | 50-100 Mbps | **20-40 Mbps** |
| TIM | 200-400 Mbps | 40-80 Mbps | **15-35 Mbps** |
| WindTre | 150-300 Mbps | 30-60 Mbps | **10-30 Mbps** |
| Iliad | 100-200 Mbps | 20-40 Mbps | **8-20 Mbps** |

**Conversione**: 20 Mbps = **2.5 MB/s**, 40 Mbps = **5 MB/s**

### Fattori che Rallentano

1. **Carrier-grade NAT** (CGNAT)
   - Condividi IP con altri utenti
   - Difficile connessione diretta P2P
   - Forza uso di STUN/TURN

2. **Traffic Shaping**
   - Operatori limitano traffico P2P/torrent
   - WebRTC può essere classificato come P2P

3. **Buffer Bloat**
   - Reti mobili hanno buffer enormi
   - Alta latenza sotto carico

4. **Congestione**
   - Celle condivise tra utenti
   - Bandwidth variabile

## 🎯 Test Consigliati

### Test 1: Stessa Rete WiFi
```
Mac WiFi → iPhone/Android WiFi (stessa rete)
Velocità attesa: 50-100 MB/s
Conferma che il codice funziona
```

### Test 2: WiFi → WiFi (reti diverse)
```
Mac Casa → PC/Mac Amico (altra rete)
Velocità attesa: 40-80 MB/s
Conferma NAT traversal
```

### Test 3: Mobile → Mobile
```
Android 5G → iPhone 5G
Velocità attesa: 3-8 MB/s
Conferma limite mobile
```

## 📊 Benchmark Realistici

### Connessioni Fibra-Mobile (Italia)

| Scenario | Upload Disponibile | Velocità Reale WebRTC | Limitazione |
|----------|-------------------|----------------------|-------------|
| Fibra → 5G | 50 Mbps mobile | **3-6 MB/s** | Upload mobile |
| Fibra → 4G+ | 20 Mbps mobile | **1.5-2.5 MB/s** | Upload mobile |
| Fibra → 4G | 10 Mbps mobile | **0.8-1.2 MB/s** | Upload mobile |
| 5G → Fibra | 100 Mbps mobile | **6-12 MB/s** | Download mobile |

### Connessioni Simmetriche

| Scenario | Velocità Teorica | Velocità Reale |
|----------|-----------------|----------------|
| Fibra → Fibra | 125 MB/s | **40-80 MB/s** |
| WiFi → WiFi (stesso router) | 150 MB/s | **50-100 MB/s** |
| 5G → 5G | 25 MB/s | **3-8 MB/s** |

## ✅ Verifica: È Normale?

**Il tuo caso**: Mac Fibra → Android 5G

Se vedi **2-6 MB/s**, è **NORMALE** ✅

Perché:
- Upload 5G reale: ~20-40 Mbps
- WebRTC overhead: ~20%
- Risultato: **2-5 MB/s**

## 🚀 Come Migliorare (Limitato)

### 1. Usa WiFi sul Mobile
```
Connetti Android al WiFi invece di 5G
Velocità attesa: 20-40 MB/s
```

### 2. Test Speed Mobile
```bash
# Verifica upload reale su speedtest.net
Se upload < 20 Mbps → Max 2.5 MB/s WebRTC
Se upload > 50 Mbps → Max 6 MB/s WebRTC
```

### 3. Cambia Operatore (se possibile)
- Vodafone/TIM: Upload migliore
- Iliad/MVNO: Upload peggiore

### 4. Ottimizza Orario
```
Test durante orari non di picco:
- Mattina presto (6-8)
- Pomeriggio (14-16)
- Sera tardi (22-24)

Evita:
- Pausa pranzo (12-14)
- Sera (18-21)
```

## 🔬 Test Avanzato

Esegui questo nella console durante il trasferimento:

```javascript
// Attendi che la connessione sia stabilita, poi:
const pc = // riferimento alla RTCPeerConnection
const stats = await pc.getStats();
stats.forEach(s => {
  if (s.type === 'candidate-pair' && s.nominated) {
    console.log('RTT:', s.currentRoundTripTime * 1000, 'ms');
    console.log('Bitrate disponibile:', s.availableOutgoingBitrate / 1000000, 'Mbps');
    console.log('Bytes inviati:', s.bytesSent);
  }
});
```

## 📝 Condividi Questo Log

Per diagnosi avanzata, dopo il prossimo test condividi:

1. Log **🎯 ACTIVE CONNECTION** (dovrebbe apparire ora)
2. Velocità misurata in MB/s
3. Test speedtest.net su mobile (screenshot upload)
4. Operatore mobile

## 💡 Conclusione

**Se vedi 2-6 MB/s su Fibra→5G**: È il massimo possibile ✅

**Per velocità più alte**: Servono entrambi su WiFi o fibra

**Il codice WebRTC è ottimizzato**: Il limite è la rete mobile
