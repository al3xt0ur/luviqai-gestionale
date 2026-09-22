# PR #1 — verifica operativa e percorso verso staging

## Ambito aggiornato

La bozza originaria era basata su schema 7. Main `c45d70e` e develop
`dcc757b` sono stati integrati nel ramo di lavoro conservando MFA, commesse,
calendario, assegnazioni multiple, rapportini e protezioni dei test.
La migrazione operativa usa **versione 20**, evitando i numeri 8–19 già occupati.
Il percorso resta feature branch → PR verso develop → staging → PR develop → main.
Questa PR resta in bozza fino al collaudo; il suo aggiornamento non distribuisce su Render.

## Comportamenti implementati

- Flussi operativi: conversione esplicita di un preventivo accettato in un solo
  pacchetto del catalogo, con controllo della revisione e motivazione. Il pacchetto
  nasce NON pagato; non vengono create fatture né registrati incassi. Il modello
  va scelto e confermato dall'utente, non dedotto dalle righe economiche.
- Squadre registrate e serie settimanali/bisettimanali su pacchetti pagati, fino
  a 52 appuntamenti totali, in Europe/Rome. Tutto viene salvato nella stessa
  transazione; saldo insufficiente e sovrapposizioni annullano l'intera richiesta.
  Gli orari inesistenti/ambigui nel cambio dell'ora vengono rifiutati.
- Le serie compaiono nel calendario esistente. Annullare una serie annulla solo
  gli appuntamenti ancora pianificati; completati e approvati restano conservati.
  La ripianificazione del singolo appuntamento usa il percorso già esistente.
- Le ricorrenze storiche del modulo Interventi restano compatibili: le nuove
  serie con giorni della settimana si gestiscono da Flussi operativi. Non sono
  migrate automaticamente le vecchie serie al nuovo registro.
- Avvisi interni: saldo basso (minuti residui, non minuti liberi), preventivo
  inviato senza risposta oltre la soglia, fattura emessa scaduta, approvazione
  in attesa. Deduplica per oggetto/tipo, lettura, risoluzione automatica e
  riapertura non letta se la condizione ricompare. Si aggiornano al caricamento
  dei dati per un responsabile/admin; non è uno scheduler in background.
- KPI: totale emesso per data documento (stati issued/paid), incassi per data
  pagamento, minuti approvati e appuntamenti pianificati per data intervento.
  Importi IVA inclusa; periodi inclusivi in Europe/Rome. Nessuna marginalità stimata.
- Gli avvisi email automatici non sono abilitati: il campo preesistente
  alert_email_enabled resta inutilizzato. Qualora richiesti, richiedono una fase
  dedicata con destinatari, consenso operativo, coda, retry e prove provider.
- Restano invariati gli ingressi commesse e interventi senza pacchetto. La
  conversione in pacchetto non sostituisce la creazione della commessa.

## Migrazioni e backup

L'avvio con PostgreSQL esterno verifica la versione 20 e **non esegue DDL**.
Su PGlite locale la migrazione resta automatica per lo sviluppo e i test.
La migrazione remota è un comando amministrativo esplicito:

```
node scripts/database.mjs migrate
```

Usare solo un ambiente già configurato per la destinazione verificata; non
incollare credenziali in comandi, log o PR. Il comando è una scrittura sul database.
Il file schema-operations.sql usa i separatori `-- next`: eseguirlo con lo script,
non incollarlo direttamente in un editor SQL.

Entrambi i comandi backup (logico e cifrato) leggono senza migrare prima. Il
formato 2 include nuove entità, assegnazioni, privacy, log e rapportini; il
ripristino accetta anche il formato 1 e rispetta le dipendenze fra tabelle.
I riferimenti agli allegati vengono conservati; eventuali oggetti esterni
richiedono un backup separato del relativo storage. Le sessioni non vengono
ripristinate. Le email pendenti vengono marcate incerte, senza invio automatico.

## Checklist prima del deploy staging

1. Fissare lo SHA candidato e ricontrollare che develop non sia avanzato.
2. Verificare CI Linux/Windows e test browser sullo stesso SHA.
3. Verificare servizio Render di staging, branch e commit di destinazione.
4. Eseguire check:staging; verificare separatamente che il database sia diverso
   dalla produzione. Il controllo delle variabili da solo non dimostra l'isolamento.
5. Usare dati fittizi e MAIL_MODE=preview, senza chiavi provider operative.
6. Creare un backup cifrato pre-migrazione e provarne il ripristino su DB vuoto.
7. Configurare il passaggio amministrativo di migrazione PRIMA dell'avvio
   della nuova versione, poi distribuire lo SHA candidato. Non fare merge
   in develop con auto-deploy attivo senza aver predisposto questo passaggio.
8. Eseguire le prove sotto e registrare gli esiti. Un health 200 non certifica
   né lo SHA distribuito né la correttezza funzionale.

## Matrice di accettazione staging

| ID | Prova | Atteso | Esito |
|---|---|---|---|
| S01 | Login/MFA, logout, cambio azienda, account operatore | Nessuna regressione; permessi conservati | Da eseguire |
| S02 | Conversione accettato; doppio clic; revisione vecchia; altra azienda | Un pacchetto non pagato; errori senza scritture parziali | Da eseguire |
| S03 | Conferma pagamento, serie 3 appuntamenti da 60 minuti | 180 minuti impegnati; calendario coerente | Da eseguire |
| S04 | Conflitto squadra/operatori e saldo insufficiente | Rifiuto atomico; saldo invariato | Da eseguire |
| S05 | Serie a cavallo dell'ora legale, singolo spostamento e annullamento serie | Orari previsti, nessun doppio addebito, storico conservato | Da eseguire |
| S06 | Quattro tipi avviso, lettura, risoluzione e riapertura | Un avviso per tipo/oggetto; nessuna email reale | Da eseguire |
| S07 | KPI con importi/data noti, fatture in bozza e annullate | Totali riconciliati, periodi inclusivi | Da eseguire |
| S08 | Backup e restore dopo conversione e serie, con assegnazioni/rapportino | Dati e collegamenti identici; email non spedite | Da eseguire |
| S09 | Preventivi, fatture, PDF, commesse senza pacchetto, privacy | Percorsi esistenti funzionanti | Da eseguire |
| S10 | Riavvio, health, log errori e accesso con due aziende | Schema stabile, nessun errore inatteso o dato incrociato | Da eseguire |

Per ogni esito registrare SHA, data, ruolo/azienda fittizia, atteso/ottenuto e
riferimento al log o schermata, senza credenziali o dati reali.

## Rollback

Conservare SHA precedente e backup pre-migrazione esterno. La nuova migrazione
è additiva, ma il solo ritorno al codice precedente non ripristina i dati:
verificare prima la compatibilità su un clone. Il vecchio backup applicativo
non conosce le nuove entità: non usarlo per salvare dati schema 20. Se serve un
ripristino completo, fermare le scritture e restaurare su un database vuoto,
verificare e solo dopo cambiare destinazione. Non cancellare tabelle operative.

## Evidenze di questa lavorazione

- Build TypeScript/Vite riuscita dopo integrazione di main e develop.
- Suite locale: 80 test riusciti, 0 falliti (PGlite, dati fittizi).
- Prove dedicate: migrazione dalla base schema 19 popolata; riapplicazione;
  backup pre-migrazione; restore di relazioni, serie e avvisi; RLS; concorrenza;
  DST; KPI; avvio esterno senza DDL.
- Test browser aggiunto alla CI Linux. Download Chromium locale fallito:
  nessun esito browser locale dichiarato.
- Collaudo su PostgreSQL remoto e staging: non eseguito in questa lavorazione.
  Nessun merge, deploy o modifica al database di produzione effettuato.
