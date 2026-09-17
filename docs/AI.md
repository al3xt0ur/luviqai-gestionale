# Assistente AI · prima versione

La sezione Assistente AI è riservata a responsabili e amministratori dentro un'impresa. Le tre consultazioni rapide sono deterministiche e funzionano senza chiave: pacchetti pagati con saldo ≤ 5 ore, fatture emesse scadute e interventi da approvare. Il testo libero usa OpenRouter per riconoscere l'intenzione, cercare clienti per nome e preparare bozze di preventivo.

## Attivazione

Creare l'account su https://openrouter.ai e generare una chiave API dalla sezione Keys. Inserirla **solo nel file locale `.env`**, mai in chat, GitHub o nel browser del gestionale:

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
```

Riavviare il backend dopo la modifica. Il router gratuito è il valore iniziale; è possibile configurare un modello specifico con suffisso `:free`, dopo averlo verificato nel catalogo OpenRouter. I modelli a pagamento vengono rifiutati dalla configurazione; non è previsto un ripiego automatico a pagamento. Il servizio gratuito può esaurire la quota o essere indisponibile. La disponibilità reale e la qualità del modello vanno verificate dopo l'inserimento della chiave.

## Dati e comportamento

Al provider vengono trasmessi soltanto istruzioni fisse e testo dell'ultimo messaggio, dopo consenso nell'interfaccia. Non inviare informazioni riservate: anche nomi o dettagli scritti nel messaggio arrivano al provider. Per la fase iniziale usare clienti fittizi. Non vengono trasmessi database, risultati, contatti, credenziali, documenti o cronologia delle conversazioni. La richiesta imposta `provider.data_collection=deny`; può ridurre i provider disponibili. La politica del fornitore va comunque verificata prima di usare dati reali.

Il backend interpreta soltanto un elenco chiuso di azioni: niente SQL, comandi, URL scelti dal modello, invii email, pagamenti o approvazioni automatiche. Il contesto aziendale deriva dalla sessione, con controlli di ruolo, CSRF e isolamento già presenti. Il testo del modello non viene presentato come risposta libera: i risultati sono costruiti dal server sui dati autorizzati.

Esempio: «Prepara un preventivo per Casa Aurora: 2 ore di pulizia a 25 euro/ora, IVA 22%». Si devono specificare quantità, prezzo e aliquota; verificare sempre l'anteprima perché il modello può interpretarli male. Data odierna e validità di 30 giorni vengono proposte esplicitamente. La conferma salva una bozza, modificabile da Preventivi, senza inviarla. Il dominio ricalcola gli importi e ricontrolla il cliente al salvataggio.

Le proposte durano 15 minuti, appartengono a utente e azienda e sono conservate solo nella memoria del processo. Un riavvio le invalida: prepararle nuovamente. Doppie conferme concorrenti usano la stessa chiave idempotente nel database, producendo una sola bozza e una voce di storico con autore e motivazione AI. La cronologia della chat è temporanea e si perde uscendo dalla sezione. Ogni messaggio è indipendente; non sono supportati riferimenti a messaggi precedenti.

Limite applicativo di 5 richieste AI/minuto/account, timeout 25 secondi, risultati limitati ai primi 50 con conteggio totale. Limiti e proposte sono locali al processo: un servizio con più repliche richiederà un archivio condiviso. Nessuna tabella o migrazione Supabase aggiunta in questa versione.

## Verifica

`tests/ai.test.mjs` usa provider simulato e database temporanei: ruoli, isolamento, conferma, duplicati, importi, scadenza, assenza di dati DB nel prompt e guasti provider. Questi test non sostituiscono una prova reale OpenRouter con la chiave configurata.

Riferimenti: https://openrouter.ai/docs/api/reference/overview e https://openrouter.ai/docs/guides/routing/routers/free-router.
