import {fileURLToPath} from 'node:url';
import nodemailer from 'nodemailer';
import {mailConfig} from '../server/mail.mjs';
try{process.loadEnvFile(fileURLToPath(new URL('../.env.mail',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
try{
 const config=mailConfig(process.env,process.env.APP_ORIGIN||'http://localhost:3000');
 if(config.mode==='preview'){console.log('Modalità simulazione: nessuna connessione SMTP e nessuna email inviata.');}
 else {const transport=nodemailer.createTransport(config.smtp);try{await transport.verify();console.log('Connessione e autenticazione SMTP verificate. Nessuna email inviata.');}finally{transport.close();}}
}catch(error){console.error('Verifica non riuscita:',error.code||'controllare configurazione email e URL pubblico');process.exitCode=1;}
