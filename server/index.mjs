import {fileURLToPath} from 'node:url';
for (const name of process.env.LUVIQ_TEST_MODE==='1'?[]:['../.env','../.env.mail']) {
  try{process.loadEnvFile(fileURLToPath(new URL(name,import.meta.url)));}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
await import('./http.mjs');
