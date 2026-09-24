# Assistente AI · modalità conversazionale

Il widget «Chiedi a luviqAI», in basso a destra nelle sezioni aziendali, è riservato a responsabili e amministratori dentro un'impresa. Le consultazioni operative note vengono risolte dal backend senza chiamare un modello esterno. Le richieste generali e conversazionali usano OpenRouter. Il modello può inoltre riconoscere azioni gestionali consentite, come cercare clienti o preparare una proposta di preventivo, ma non può eseguire direttamente modifiche distruttive, pagamenti, approvazioni o invii.

## Attivazione

Creare l'account su https://openrouter.ai e generare una chiave API dalla sezione Keys. Inserirla **solo nel file locale `.env`**, mai in chat, GitHub o nel browser del gestionale:

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
```

Riavviare il backend dopo la modifica. Il router gratuito è il valore iniziale; è possibile configurare un modello specifico con suffisso `:free`, dopo averlo verificato nel catalogo OpenRouter. I modelli a pagamento vengono rifiutati dalla configurazione; non è previsto un ripiego automatico a pagamento. Il servizio gratuito può esaurire la quota o essere indisponibile. La disponibilità reale e la qualità del modello vanno verificate dopo l'inserimento della chiave.

## Dati e comportamento

Le domande operative riconosciute localmente vengono elaborate sul server LuviqAI e non richiedono OpenRouter. Le richieste libere vengono inviate a OpenRouter insieme a una breve cronologia limitata alle sole parti conversazionali necessarie a mantenere il filo. I risultati estratti dal database non vengono inseriti nella cronologia inviata al modello.

Le chiamate OpenRouter impostano `provider.data_collection=deny` e `provider.zdr=true`. Questo restringe il routing agli endpoint compatibili con le protezioni richieste; se nessun endpoint gratuito compatibile è disponibile, la richiesta può fallire invece di degradare verso un provider meno restrittivo. OpenRouter può comunque conservare metadati tecnici della richiesta.

Non è prevista una checkbox di consenso per ogni messaggio. L'interfaccia mostra una nota persistente sul possibile uso di OpenRouter per le richieste libere e l'informativa privacy descrive il trattamento. La corretta base giuridica e gli accordi con i fornitori devono essere verificati prima dell'uso con dati reali o di terzi.

Le azioni gestionali restano su un elenco chiuso. Il modello non riceve accesso SQL o accesso diretto al database e non può inviare email, registrare pagamenti o approvare interventi. Le operazioni di scrittura consentite, come una bozza di preventivo, richiedono una proposta esplicita e una conferma dell'utente; il dominio ricalcola e valida i dati al salvataggio.

La cronologia della chat è temporanea e resta nel browser durante la sessione; si perde ricaricando la pagina o uscendo. Il backend applica un limite di 5 richieste OpenRouter/minuto/account e timeout di 25 secondi. Le consultazioni locali non consumano tale limite.

## Verifica

`tests/ai.test.mjs` usa provider simulato e database temporanei: ruoli, isolamento, conferma, duplicati, importi, scadenza, assenza di dati DB nel prompt e guasti provider. Questi test non sostituiscono una prova reale OpenRouter con la chiave configurata.

Riferimenti: https://openrouter.ai/docs/api/reference/overview e https://openrouter.ai/docs/guides/routing/routers/free-router.
