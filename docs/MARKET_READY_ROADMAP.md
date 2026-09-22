# LuviqAI Market Ready — roadmap

Aggiornata al candidato PR #1 del 22 settembre 2026. Legenda:

- `[x]`: presente nella base `main`/`develop` integrata;
- `[PR #1]`: presente nel candidato, ma non ancora collaudato in staging né in produzione;
- `[da verificare]`: configurazione esterna dichiarata nel repository, da confermare nel provider;
- `[ ]`: non completato.

## Milestone 0 — Fondazione prodotto
Stato: IMPLEMENTATA NELLA BASE, COLLAUDO PR #1 IN CORSO

- [x] Ambiente develop/staging/main separato.
- [x] CI Linux/Windows e protezione main.
- [da verificare] Database staging separato.
- [da verificare] Dominio e servizio staging.
- [x] Definizione formale del modello Commessa e ADR.
- [x] Introduzione schema commesse senza rompere i dati esistenti.
- [x] Collegamenti Preventivo → Commessa → Intervento.
- [ ] Collegamento diretto Commessa → Fattura; oggi la fattura può partire dal preventivo accettato.
- [x] Test automatici di retrocompatibilità.

Criterio di uscita: una commessa può essere creata da un preventivo accettato e può contenere interventi, senza modificare i flussi legacy.

## Milestone 1 — Sicurezza e affidabilità commerciale

- [x] Recupero password self-service via email.
- [x] MFA per platform_admin e responsabili.
- [x] Workflow di backup esterno cifrato con retention.
- [PR #1] Restore applicativo provato automaticamente su PGlite; resta la prova su clone PostgreSQL staging.
- [x] Monitoraggio esterno health/uptime.
- [x] Alert errori applicativi.
- [x] Gestione sessioni/dispositivi.
- [ ] Revisione rate limit dietro reverse proxy.

Criterio di uscita: incidente simulato con restore riuscito e account amministrativi protetti da MFA.

## Milestone 2 — Field Service completo

- [x] Commesse.
- [x] Interventi ricorrenti settimanali/mensili nella base.
- [PR #1] Serie operative settimanali/bisettimanali con registro dedicato.
- [x] Multi-operatore.
- [x] Controllo disponibilità tramite conflitti di pianificazione.
- [x] Controllo conflitti server-side.
- [x] Checklist.
- [x] Foto e allegati.
- [x] Timer inizio/fine.
- [x] Firma cliente.
- [x] Rapportino PDF.
- [ ] Sedi cliente.
- [ ] Mappa e navigazione.

Criterio di uscita: un operatore può eseguire da mobile l'intero ciclo di un lavoro.

## Milestone 3 — Portale cliente

- [ ] Accesso cliente / magic link.
- [ ] Dashboard ore acquistate/consumate/impegnate/libere.
- [ ] Prossimi interventi.
- [ ] Storico rapportini.
- [ ] Preventivi.
- [ ] Fatture.
- [ ] Richiesta nuovo intervento.
- [ ] Rinnovo pacchetto.
- [ ] Download documenti.

Criterio di uscita: il cliente può servire se stesso per le operazioni principali senza contattare l'azienda.

## Milestone 4 — Pagamenti e ricavi

- [ ] Stripe o provider equivalente.
- [ ] Acconti su preventivo.
- [ ] Pagamento fatture.
- [ ] Rinnovo pacchetti online.
- [ ] Pagamenti ricorrenti LuviqAI.
- [ ] Piani e limiti SaaS.
- [ ] Trial.
- [ ] Sospensione per abbonamento scaduto.

## Milestone 5 — Fatturazione elettronica Italia

- [ ] Integrazione provider (priorità: Fatture in Cloud API).
- [ ] Sincronizzazione anagrafiche/documenti.
- [ ] Invio e-fattura.
- [ ] Stati SDI/provider.
- [ ] Errori e retry controllati.
- [ ] Webhook di aggiornamento.
- [ ] Riconciliazione con fatture LuviqAI.

## Milestone 6 — Automazioni

- [PR #1] Avvisi interni per preventivi senza risposta, fatture scadute, saldo basso e approvazioni in attesa; aggiornati al caricamento dei dati.
- [ ] Reminder preventivi automatici/email.
- [ ] Reminder appuntamenti.
- [ ] Solleciti fatture.
- [ ] Alert saldo ore.
- [ ] Proposta rinnovo automatica.
- [ ] Richiesta recensione.
- [ ] Eventi ricorrenti.
- [ ] Regole configurabili per tenant.

## Milestone 7 — Analytics

- [PR #1] KPI base: emesso, incassato per data pagamento, minuti approvati e appuntamenti pianificati.
- [ ] Fatturato analitico completo.
- [ ] Pipeline.
- [ ] Conversione preventivi.
- [ ] Scaduto e DSO.
- [ ] Utilizzo operatori.
- [ ] Ore vendute vs erogate.
- [ ] Margine cliente/commessa.
- [ ] Retention/rinnovi.
- [ ] Forecast.

## Milestone 8 — AI operativa

- [ ] Query naturali sui KPI.
- [ ] Suggerimento pianificazione.
- [ ] Rinnovi proposti.
- [ ] Follow-up preventivi proposti.
- [ ] Riepilogo cliente.
- [ ] Riepilogo commessa.
- [ ] Analisi anomalie.
- [ ] Conferma umana per ogni mutazione sensibile.

## Elementi distintivi LuviqAI

1. Wallet ore trasparente per azienda e cliente.
2. AI operativa con conferma e audit.
3. Flusso semplice per PMI di servizi, non ERP generalista.
4. Portale cliente centrato su ore, attività e rinnovi.
5. Tracciabilità completa del lavoro svolto.
