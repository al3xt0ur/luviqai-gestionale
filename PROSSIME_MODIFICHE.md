# Prossime modifiche

Stato riferito al candidato della PR #1 del 22 settembre 2026. Le voci presenti
solo nel candidato non sono ancora disponibili in produzione.

## Completate nella prima consegna del 15 settembre 2026

- [x] Archiviazione e ripristino clienti, con conferma, motivazione e storico. Blocco in presenza di ore residue o interventi aperti.
- [x] Aziende separate, database PostgreSQL locale (PGlite) e adattatore PostgreSQL esterno.
- [x] Accessi responsabile/operatore, sessioni personali, permessi e assegnazione interventi.
- [x] Identità aziendale configurabile: nome, colore, sigla del logo, email e indirizzo.
- [x] Importazione una tantum dei dati SQLite e conservazione del database precedente.
- [x] Ripianificazione con motivazione, backup automatici locali e ripristino verificato.
- [x] Recupero password con link monouso generato dall’amministratore, senza email reali.

## Da implementare nelle consegne successive

Completato anche il pannello amministrativo luviqAI: due account personali con autorità su tutte le imprese, gestione aziende, accesso tracciato, sospensione/riattivazione e reset degli account aziendali.

- [x] Catalogo pacchetti configurabile, preventivi con PDF e logo, stati e storico.
- [x] Email in anteprima/SMTP, risposta cliente con note, notifiche e nuova proposta dopo un rifiuto.
- [x] Conversione esplicita dei preventivi accettati in pacchetto non pagato nel candidato PR #1. La creazione della commessa e degli interventi resta un passaggio separato.
- [x] Fatturazione interna: documenti, PDF, scadenze e registrazione pagamenti.
- [ ] Servizio di fatturazione elettronica.
- [x] Assistente AI iniziale: consultazioni e bozze preventivi con conferma, permessi e storico.
- [ ] Attivazione chiave OpenRouter, valutazione del modello reale ed estensione delle operazioni AI.
- [ ] Account clienti con accesso ai propri dati.
- [ ] Abbonamenti luviqAI, limiti e incasso ricorrente.
- [x] Repository GitHub condiviso e database PostgreSQL su Supabase.
- [x] Hosting Render, recupero password email, MFA, monitoraggio e workflow di backup cifrato.
- [x] Avvisi interni e KPI base nel candidato PR #1.
- [ ] Scheduler e invio email per reminder preventivi/appuntamenti, solleciti fatture e saldo ore.
- [ ] Collaudo PostgreSQL/staging e prova documentata di ripristino prima del merge della PR #1.

Nessuna cancellazione definitiva dello storico. Database operativo su Supabase; nessun incasso automatico collegato.
