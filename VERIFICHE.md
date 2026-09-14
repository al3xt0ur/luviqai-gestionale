# Verifica della demo

Eseguita il 14 settembre 2026 con Node.js 24.19.0 su Windows.

- Compilazione TypeScript senza errori e build Vite riuscita.
- 9 test automatici superati: conteggio operatore/squadra, minuti interi, importazione, pagamento, disponibilità, idempotenza, rettifiche, annullamenti, completamento e date future, rinnovo, storico e persistenza.
- Test HTTP: 12 richieste di approvazione simultanee con la stessa chiave producono un solo addebito e una sola voce di storico; 8 successive con chiavi diverse sono respinte. Su 6 richieste simultanee per la stessa disponibilità, una sola viene accettata.
- Riavvio reale del processo: dati e chiavi idempotenti conservati, senza nuova inizializzazione della demo.
- Percorso nel browser Chrome completato: creazione e modifica cliente, importazione di 60 minuti, rifiuto di intervento oltre disponibilità, pianificazione, completamento, approvazione, rettifica motivata, annullamento con restituzione, rinnovo e download CSV.
- Interfaccia controllata a 1440 px e 390 px; nessuno sconfinamento orizzontale della pagina mobile e nessun errore JavaScript. Tabelle scorrevoli orizzontalmente su telefono.
- Riepilogo cliente generato in PDF tramite il motore di stampa del browser.

Le prove usano database temporanei isolati. I file di prova visuali sono in `test-results`, esclusi dal repository. La demo operativa rimane con i quattro clienti fittizi iniziali.
