# Sistema di Versioning Automatico

## Come Funziona

Ogni volta che esegui un build di produzione o un deploy, il numero di versione viene **automaticamente incrementato**.

### File Coinvolti

- `package.json` - Contiene la versione principale (es: 1.0.42)
- `src/version.ts` - File auto-generato con versione, build number e data (NON committare)
- `src/environments/environment.ts` - Sincronizzato con la versione
- `src/environments/environment.prod.ts` - Sincronizzato con la versione

### Script Disponibili

```bash
# Build di produzione (incrementa versione automaticamente)
npm run build:prod

# Build Electron (incrementa versione automaticamente)
npm run electron:build        # Tutte le piattaforme
npm run electron:build:win    # Solo Windows
npm run electron:build:mac    # Solo macOS
npm run electron:build:linux  # Solo Linux

# Deploy Firebase (incrementa versione automaticamente)
npm run deploy

# Incrementa solo la versione senza build
npm run version:bump
```

### Cosa Viene Incrementato

- **Versione Patch**: 1.0.0 → 1.0.1 → 1.0.2 (incremento automatico)
- **Build Number**: Timestamp univoco (es: 1707743521847)
- **Build Date**: Data e ora ISO completa

### Console Output

All'avvio dell'app, nella console del browser vedrai:

```
🚀 Bam - P2P File Sharing
Version: 1.0.42 (Build #1707743521847)
Build Date: 12/2/2024, 14:32:01
Environment: Production
```

### Note Importanti

1. **NON modificare manualmente** `src/version.ts` - viene rigenerato ad ogni build
2. Per incrementare **minor** o **major**, modifica manualmente `package.json` prima del build
3. Il file `version.ts` è nel `.gitignore` perché è auto-generato

### Incremento Manuale Versione Major/Minor

```bash
# Modifica manualmente in package.json:
# 1.0.42 → 2.0.0 (major)
# 1.0.42 → 1.1.0 (minor)

# Poi esegui
npm run version:bump
```

## Esempio Output Script

```bash
$ npm run build:prod

✅ Version incremented: 1.0.41 → 1.0.42
📦 Build number: 1707743521847
📅 Build date: 2024-02-12T13:32:01.847Z
✅ Updated: environment.prod.ts
✅ Updated: environment.ts
```
