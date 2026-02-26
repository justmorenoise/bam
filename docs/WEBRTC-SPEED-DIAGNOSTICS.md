# Diagnostica Velocità WebRTC

## 🔍 Come Verificare il Tipo di Connessione

Quando fai un trasferimento, controlla la **Console del Browser**:

### ✅ Connessione Ottimale (Veloce)

```
📍 Local candidate: { type: 'host', ... }
📍 Remote candidate: { type: 'host', ... }
🎯 Active ICE candidate pair: { ... }
```
**Velocità attesa**: 50-100 MB/s (fibra 1 Gbps)

### ⚡ Connessione Buona (Media)

```
📍 Local candidate: { type: 'srflx', ... }
📍 Remote candidate: { type: 'srflx', ... }
```
**Velocità attesa**: 20-50 MB/s (attraverso STUN)

### 🐌 Connessione Lenta (Relay)

```
📍 Local candidate: { type: 'relay', ... }
📍 Remote candidate: { type: 'relay', ... }
```
**Velocità attesa**: 2-10 MB/s (attraverso TURN relay)

## 🚀 Ottimizzazioni Implementate

### 1. Chunk Size Aumentata
- Prima: 16 KB
- Ora: 64 KB
- Beneficio: Meno overhead, più throughput

### 2. Buffer Aumentato
- Prima: 64 KB
- Ora: 1 MB
- Beneficio: Mantiene il canale saturo

### 3. Backpressure Migliorata
- Prima: Polling lento (200ms)
- Ora: Polling rapido (10ms)
- Beneficio: Reazione immediata

### 4. TURN Server Ottimizzati
- **Development**: Solo STUN (forza connessione diretta)
- **Production**: TURN europei prioritari

## 🛠️ Test e Diagnosi

### Test 1: Connessione Locale (Stessa Rete)
```bash
# Mittente e destinatario sulla stessa WiFi/LAN
# Dovrebbe usare candidati 'host' → 50-100 MB/s
```

### Test 2: Connessione Remota (Reti Diverse)
```bash
# Mittente e destinatario su reti diverse
# Verifica quale tipo di candidato viene usato
```

### Test 3: Dietro NAT Simmetrico
```bash
# Se entrambi dietro NAT simmetrico → usa TURN relay
# Velocità limitata a 2-10 MB/s
```

## 🔧 Soluzioni per Connessione Lenta

### Problema: Usa TURN Relay

**Causa**: NAT/Firewall impedisce connessione diretta

**Soluzione 1**: Usa TURN server più vicini
- Twilio (Frankfurt, Germania) - **Consigliato per Italia**
- Configurazione in `environment.prod.ts`
- [Registrati gratis su Twilio](https://www.twilio.com/stun-turn)

**Soluzione 2**: Configura Port Forwarding
```
Router → Port Forwarding → UDP 49152-65535
Consente connessione diretta senza TURN
```

**Soluzione 3**: Disabilita Firewall (solo test)
```bash
# Windows
netsh advfirewall set allprofiles state off

# Mac
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off
```

## 📊 Tabella Performance Attesa

| Tipo Connessione | Candidati | Velocità | Latenza | Uso TURN |
|------------------|-----------|----------|---------|----------|
| **Ottimale** | host ↔ host | 50-100 MB/s | <10ms | ❌ No |
| **Buona** | srflx ↔ srflx | 20-50 MB/s | 10-30ms | ❌ No |
| **Media** | relay ↔ srflx | 10-20 MB/s | 30-100ms | ⚠️ Parziale |
| **Lenta** | relay ↔ relay | 2-10 MB/s | 100-300ms | ✅ Sì |

## 🌍 Server TURN Consigliati per l'Italia

### 1. Twilio (Frankfurt) ⭐ Consigliato
- Latenza: ~20-30ms dall'Italia
- Velocità: Alta
- Costo: Gratis fino a 500 MB, poi pay-as-you-go
- [Registrazione](https://www.twilio.com/console/video/project/testing-tools)

### 2. Xirsys (Frankfurt)
- Latenza: ~25-35ms
- Velocità: Alta
- Costo: Gratis fino a 500 MB/mese
- [Registrazione](https://xirsys.com/)

### 3. Metered.ca (US/CA) 
- Latenza: ~150-200ms dall'Italia ⚠️
- Velocità: Media-Bassa
- Costo: Gratis fino a 50GB/mese
- Già configurato come fallback

## ✅ Checklist Ottimizzazione

- [ ] Test connessione locale (stessa rete) → Dovrebbe essere veloce
- [ ] Verifica log console per tipo candidati
- [ ] Se usa 'relay', configura TURN europeo (Twilio)
- [ ] Se possibile, abilita UPnP sul router
- [ ] Considera port forwarding per UDP
- [ ] Test con firewall disabilitato (diagnosi)

## 🎯 Obiettivi di Performance

Con fibra 1 Gbps:
- **Stesso WiFi**: 50-100 MB/s (limitato da CPU browser)
- **Reti diverse (diretta)**: 40-80 MB/s
- **Attraverso TURN EU**: 15-30 MB/s
- **Attraverso TURN US**: 5-15 MB/s

## 📝 Log da Condividere

Se il problema persiste, condividi:
```javascript
// Dalla console del browser dopo connessione:
1. Tutti i log con 📍 (candidati)
2. Il log con 🎯 (coppia attiva)
3. La velocità di trasferimento misurata
```
