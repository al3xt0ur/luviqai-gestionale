# Allegati interventi · Storage privato

Gli allegati degli interventi non vengono salvati nel database PostgreSQL. Il database conserva solo i metadati; i file vengono archiviati in un bucket privato Supabase Storage e sono serviti esclusivamente tramite il backend autenticato di luviqAI.

## Configurazione richiesta

Creare un bucket Supabase Storage **privato** chiamato, ad esempio:

`luviqai-private`

Nel servizio Render configurare:

- `SUPABASE_URL`: URL del progetto Supabase, ad esempio `https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: service role key del progetto. È un segreto server-side e non deve mai essere inserito nel frontend o condiviso in chat.
- `SUPABASE_STORAGE_BUCKET`: nome del bucket privato, ad esempio `luviqai-private`

Usare progetti/bucket separati per staging e produzione.

## Sicurezza

La service role key rimane solo nel backend. Il browser non riceve credenziali Supabase né URL pubblici del bucket.

Upload, download e cancellazione passano da API luviqAI autenticate. Il backend verifica prima che l'intervento appartenga all'azienda della sessione e, per gli operatori, che l'intervento sia effettivamente assegnato al loro account.

I file sono organizzati con prefisso:

`<tenant-id>/interventions/<intervention-id>/...`

Il bucket deve restare privato. Non abilitarlo come public.

## Limiti

Massimo 8 MB per file.

Formati consentiti:

- JPG
- PNG
- WebP
- PDF
- TXT
- DOCX

SVG e HTML non sono ammessi.

## Verifica

Dopo il deploy:

1. aprire un intervento;
2. entrare in **Rapportino**;
3. la sezione **Foto e allegati** non deve mostrare “Storage da configurare”;
4. caricare una foto;
5. verificare anteprima e download;
6. accedere con un altro tenant/account non assegnato e verificare che il file non sia accessibile;
7. eliminare il file e verificare che scompaia sia dal gestionale sia dal bucket.

La rotta `/api/storage/status` comunica solo se lo storage è pronto; non espone URL o chiavi.
