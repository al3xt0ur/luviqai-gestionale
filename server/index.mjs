import {fileURLToPath} from 'node:url';
for (const name of ['../.env','../.env.mail']) {
  try{process.loadEnvFile(fileURLToPath(new URL(name,import.meta.url)));}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
await import('./http.mjs');
