# Email, notifiche e risposte ai preventivi

## Prova locale

La modalità predefinita è **simulazione locale**: nessuna email reale viene spedita. L’app carica il file riservato `.env.mail` all’avvio, escluso da Git. Per questa installazione è predisposto il mittente Gmail indicato dal gestore; password e indirizzo pubblico non sono ancora configurati. Non mettere credenziali in chat o nei sorgenti.

1. Inserire un’email valida nel cliente; se il preventivo esiste già, salvare nuovamente la bozza per aggiornare il destinatario nel documento.
2. Aprire il preventivo e scegliere **Invia via email → Conferma invio email**. Verificare il destinatario prima di confermare. Modifiche e operazioni manuali sono bloccate finché l’invio è in corso o da verificare.
3. In **Email e notifiche** aprire il messaggio: contiene PDF allegato e un collegamento personale. Si può scaricare il messaggio completo in formato EML. In simulazione il preventivo passa a inviato per consentire la prova, ma l’app segnala che non è partita alcuna email.
4. **Apri pagina cliente** permette di provare il flusso anche senza login, preferibilmente in una finestra privata. Nell’email HTML i pulsanti Accetta e Rifiuta aprono la pagina con la scelta preselezionata. Nome, eventuali note e conferma finale registrano la risposta. Una visita GET, un download o uno scanner email non possono accettare il preventivo.
5. Il preventivo viene aggiornato, lo storico registra la risposta e compare una notifica. La pagina gestionale aggiorna i dati ogni 10 secondi quando è visibile; Email e notifiche aggiorna l’elenco ogni 5 secondi. L’email aziendale in **Identità dell’impresa** riceve un riepilogo (simulato se il collegamento iniziale era simulato). Se manca quel recapito resta comunque la notifica nell’app.

I collegamenti localhost funzionano solo sul computer su cui è avviata l’app. Per i clienti esterni serve un indirizzo pubblico HTTPS.

## Collegamento Gmail e invio reale

Il trasporto SMTP è predisposto, ma **non è stato collegato o verificato con una casella reale**. Per attivarlo servono l’app raggiungibile via HTTPS e una password per le app Google. Le [istruzioni Google](https://support.google.com/accounts/answer/185833?hl=it) richiedono la verifica in due passaggi; l’opzione può non essere disponibile per alcuni account. Non utilizzare la normale password di Gmail. Parametri documentati da [Google per SMTP](https://support.google.com/a/answer/176600?hl=it).

Nel file privato `.env.mail` configurare, soltanto quando l’hosting è pronto:

```dotenv
MAIL_MODE=smtp
MAIL_FROM=indirizzo-mittente@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=indirizzo-mittente@gmail.com
SMTP_PASSWORD=password-per-le-app
APP_ORIGIN=https://gestionale.example.com
PUBLIC_APP_URL=https://gestionale.example.com
```

Per tornare alla prova locale usare `MAIL_MODE=preview`, ripristinare gli URL localhost e riavviare. Il passaggio a SMTP abilita spedizioni vere quando si conferma un invio nell’app o arriva una risposta da un collegamento già spedito.

Le imprese usano il mittente SMTP della piattaforma con nome aziendale e Reply-To dell’impresa. Non viene falsificato un indirizzo mittente non verificato. SMTP e credenziali sono gestiti dal proprietario della piattaforma, non dagli operatori o dai clienti. Le caselle Gmail distinte per ciascuna impresa e l’accesso Google OAuth non fanno parte di questa versione.

Verifica della connessione senza spedire email:

```powershell
node scripts/mail-check.mjs
```

Riavviare il server dopo modifiche alla configurazione. Il worker elabora la coda persistente ogni 2 secondi, anche se il browser è chiuso ma il server resta acceso. “Accettata dal server email” indica la presa in carico SMTP, non lettura o recapito garantito. Non sono implementati tracciamento aperture, gestione automatica rimbalzi o notifiche diverse dalle risposte ai preventivi.

## Errori e duplicati

### Trattativa dopo un rifiuto

Aprire il preventivo rifiutato e scegliere **Rivedi proposta**. L’editor riprende servizi, prezzi e condizioni per lo stesso cliente, con nuove date. Modificare l’offerta e salvare la bozza; quindi usare **Invia via email**. Viene creato un nuovo numero con un collegamento alla proposta precedente. Il rifiuto, gli importi e le note originali rimangono nello storico. I collegamenti “Proposta collegata a” e “Proposte successive” consentono di spostarsi tra le offerte. La nuova proposta ha un proprio invio e un nuovo collegamento di risposta.

La nuova offerta non sostituisce il documento rifiutato e non riattiva il suo vecchio collegamento. Se viene rifiutata nuovamente, si può ripetere il percorso per continuare la trattativa.

Un errore SMTP o un invio interrotto è segnato **Da verificare**: non viene ripetuto automaticamente, perché un timeout può avvenire dopo la consegna. Dopo aver controllato la casella mittente, il responsabile può chiudere il tentativo con motivazione; il vecchio collegamento viene revocato. Un nuovo tentativo sarà quindi esplicito. Gli invii interrotti vengono segnalati dopo due minuti. Il ripristino di un backup blocca gli invii pendenti da verificare e non provoca spedizioni inattese.

Le risposte duplicate identiche non producono altri aggiornamenti o notifiche; una scelta diversa dopo la conferma viene rifiutata. Per correggerla il cliente deve contattare l’impresa. Ore e pagamenti non cambiano automaticamente.

## Riservatezza dei collegamenti

I collegamenti sono casuali e personali, senza necessità di account cliente. Scadono entro 30 giorni; la risposta è bloccata oltre la validità del preventivo, per un’impresa sospesa o dopo l’annullamento della proposta.

Il collegamento è una credenziale riservata: chi lo possiede può rispondere. Il nome inserito non costituisce autenticazione dell’identità né firma elettronica. I token sono sotto hash nella tabella dei collegamenti; il collegamento completo resta nel messaggio riservato, necessario alla coda e all’anteprima. Messaggi, PDF e risposte sono inclusi nei backup e vanno trattati come riservati. Gli operatori e le altre imprese non possono accedervi.

## Logo e layout

In **Azienda e account → Identità dell’impresa** caricare il logo originale PNG o JPEG (massimo 500 KB), poi salvare. Il backend valida e normalizza l’immagine; SVG, immagini corrotte o eccessive sono rifiutati. Si possono inserire telefono, sito e partita IVA/codice fiscale. Senza immagine viene usato un monogramma: non viene inventato il logo dell’impresa.

Logo e recapiti sono copiati nel preventivo all’ultimo salvataggio della bozza. Per includerli in una bozza esistente, aprire **Modifica bozza** e salvarla con motivazione. I preventivi già inviati restano invariati; per una nuova proposta usare **Duplica**. Il layout rivisto con Sol è mantenuto. Anche il PDF dell’email viene congelato al momento della preparazione, così i download successivi del destinatario restituiscono l’allegato originale.

## Test

La suite `node --test tests/*.test.mjs` verifica isolamento, token, scadenza, duplicati e concorrenza, errori SMTP senza retry, backup e riavvio. SMTP è provato tramite trasporto simulato, senza inviare messaggi a caselle vere.

Con Playwright e Chrome:

```powershell
node tests/browser-mail.mjs
node tests/browser-quotes.mjs
```

È possibile passare il percorso del modulo Playwright come primo argomento. Il browser prova email EML con PDF, collegamento cliente senza sessione, scelta preselezionata, note, conferma, aggiornamento e notifica letta. Le immagini e i documenti di test usano dati fittizi e restano in `test-results/`, escluso da Git.
