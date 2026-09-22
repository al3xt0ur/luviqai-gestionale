const apiKey=process.env.ALERT_RESEND_API_KEY;
const from=process.env.ALERT_MAIL_FROM;
const to=process.env.ALERT_MAIL_TO;
const target=process.env.HEALTHCHECK_URL||process.argv[2]||'';
const detail=process.env.HEALTHCHECK_DETAIL||'Endpoint non raggiungibile o stato degradato.';
if(!apiKey||!from||!to)throw Error('Configurazione email alert incompleta.');
if(!target)throw Error('HEALTHCHECK_URL non configurato.');

const checkedAt=new Date().toISOString();
const subject='luviqAI: anomalia monitoraggio';
const text=[
  'luviqAI ha rilevato un problema durante il controllo automatico.',
  '',
  'Endpoint: '+target,
  'Ora controllo: '+checkedAt,
  'Dettaglio: '+detail,
  '',
  'Verifica GitHub Actions e Render prima di intervenire sul database.'
].join('\n');

const response=await fetch('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({from,to:[to],subject,text})
});
if(!response.ok){
  const body=await response.text();
  throw Error('Invio alert non riuscito: HTTP '+response.status+' '+body.slice(0,300));
}
console.log('Alert email inviato a',to);
