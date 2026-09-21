# LuviqAI Market Ready — roadmap

## Milestone 0 — Fondazione prodotto
Stato: IN CORSO

- [x] Ambiente develop/staging/main separato.
- [x] CI Linux/Windows e protezione main.
- [x] Database staging separato.
- [x] Dominio staging.
- [ ] Definizione formale del modello Commessa.
- [ ] Introduzione schema commesse senza rompere i dati esistenti.
- [ ] Collegamenti Preventivo → Commessa → Intervento → Fattura.
- [ ] Test automatici di retrocompatibilità.

Criterio di uscita: una commessa può essere creata da un preventivo accettato e può contenere interventi, senza modificare i flussi legacy.

## Milestone 1 — Sicurezza e affidabilità commerciale

- [ ] Recupero password self-service via email.
- [ ] MFA per platform_admin e manager.
- [ ] Backup esterno con retention.
- [ ] Restore test documentato.
- [ ] Monitoraggio esterno health/uptime.
- [ ] Alert errori applicativi.
- [ ] Gestione sessioni/dispositivi.
- [ ] Revisione rate limit dietro reverse proxy.

Criterio di uscita: incidente simulato con restore riuscito e account amministrativi protetti da MFA.

## Milestone 2 — Field Service completo

- [ ] Commesse.
- [ ] Interventi ricorrenti.
- [ ] Multi-operatore.
- [ ] Disponibilità operatori.
- [ ] Controllo conflitti server-side.
- [ ] Checklist.
- [ ] Foto e allegati.
- [ ] Timer inizio/fine.
- [ ] Firma cliente.
- [ ] Rapportino PDF.
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

- [ ] Reminder preventivi.
- [ ] Reminder appuntamenti.
- [ ] Solleciti fatture.
- [ ] Alert saldo ore.
- [ ] Proposta rinnovo automatica.
- [ ] Richiesta recensione.
- [ ] Eventi ricorrenti.
- [ ] Regole configurabili per tenant.

## Milestone 7 — Analytics

- [ ] Fatturato.
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
