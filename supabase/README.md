# Supabase Setup per Bam

## 1. Crea un Progetto Supabase

1. Vai su [supabase.com](https://supabase.com)
2. Crea un nuovo progetto
3. Annota le credenziali:
   - `Project URL`
   - `anon/public key`

## 2. Configura le Credenziali

Aggiungi le credenziali in `src/environments/environment.ts` e `environment.prod.ts`:

```typescript
export const environment = {
  production: false,
  supabase: {
    url: 'TUA_PROJECT_URL',
    anonKey: 'TUA_ANON_KEY'
  },
  // ...
};
```

## 3. Esegui le Migrations

### Opzione A: Tramite Dashboard Supabase

1. Vai su `SQL Editor` nel tuo progetto Supabase
2. Crea una nuova query
3. Copia e incolla il contenuto di `001_initial_schema.sql`
4. Esegui la query

### Opzione B: Tramite Supabase CLI

```bash
# Installa Supabase CLI
npm install -g supabase

# Login
supabase login

# Link al progetto
supabase link --project-ref TUO_PROJECT_REF

# Esegui migration
supabase db push
```

## 4. Configura Auth Providers (Opzionale)

### Google OAuth

1. Vai su `Authentication > Providers` nel dashboard Supabase
2. Abilita Google provider
3. Crea credenziali OAuth su [Google Cloud Console](https://console.cloud.google.com/)
4. Aggiungi Client ID e Client Secret in Supabase

## 5. Configura Realtime (per Signaling WebRTC)

Realtime è già abilitato per la tabella `file_transfers` nella migration.

## 6. Setup Cron Jobs (Opzionale)

Per eseguire task periodici, usa Supabase Edge Functions o un servizio esterno:

### Reset Daily File Counts (Ogni giorno a mezzanotte)

```sql
SELECT reset_daily_file_counts();
```

### Expire Old Transfers (Ogni ora)

```sql
SELECT expire_old_transfers();
```

## 7. Test delle Funzioni

```sql
-- Test increment download count
SELECT increment_download_count('test-link-id');

-- Test increment daily files
SELECT increment_daily_files('user-uuid');

-- Test reset daily counts
SELECT reset_daily_file_counts();

-- Test expire transfers
SELECT expire_old_transfers();
```

## 8. Verifica Row Level Security

Le policies RLS sono già configurate per:
- Utenti possono vedere/modificare solo il proprio profilo
- Utenti possono vedere solo i propri trasferimenti
- Chiunque può vedere trasferimenti attivi tramite link_id

## Struttura Database

### Tabella: `user_profiles`
- `id` (UUID, PK) - ID utente da auth.users
- `email` (TEXT) - Email utente
- `full_name` (TEXT) - Nome completo
- `tier` (TEXT) - free/premium
- `daily_files_count` (INTEGER) - Contatore giornaliero
- `xp_points` (INTEGER) - Punti XP per gamification

### Tabella: `file_transfers`
- `id` (UUID, PK) - ID trasferimento
- `sender_id` (UUID, FK) - ID utente sender
- `file_name` (TEXT) - Nome file
- `file_size` (BIGINT) - Dimensione in bytes
- `file_hash` (TEXT) - Hash SHA-256 del file
- `mode` (TEXT) - burn/seed
- `link_id` (TEXT, UNIQUE) - ID univoco per il link
- `password_protected` (BOOLEAN) - Se protetto da password
- `downloads_count` (INTEGER) - Contatore download
- `status` (TEXT) - active/completed/expired

## Troubleshooting

### Errore: "relation does not exist"
- Verifica che la migration sia stata eseguita correttamente
- Controlla i log SQL Editor per errori

### Errore: "RLS policy violation"
- Verifica che l'utente sia autenticato
- Controlla le policies RLS

### Realtime non funziona
- Verifica che Realtime sia abilitato nel progetto
- Controlla che la tabella sia pubblicata: `ALTER PUBLICATION supabase_realtime ADD TABLE file_transfers;`
