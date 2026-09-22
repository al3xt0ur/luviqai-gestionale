import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

function keyFromEnv(value=process.env.BACKUP_ENCRYPTION_KEY){
  if(!value) throw Error('BACKUP_ENCRYPTION_KEY mancante.');
  let key;
  try{key=Buffer.from(value,'base64url');}catch{throw Error('BACKUP_ENCRYPTION_KEY non valida.');}
  if(key.length!==32)throw Error('BACKUP_ENCRYPTION_KEY deve contenere esattamente 32 byte codificati base64url.');
  return key;
}

export function encryptBackup(plain,keyValue){
  const key=keyFromEnv(keyValue),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
  return {
    version:1,
    algorithm:'aes-256-gcm',
    created:new Date().toISOString(),
    iv:iv.toString('base64url'),
    tag:cipher.getAuthTag().toString('base64url'),
    ciphertext:ciphertext.toString('base64url')
  };
}

export function decryptBackup(envelope,keyValue){
  if(!envelope||envelope.version!==1||envelope.algorithm!=='aes-256-gcm')throw Error('Formato backup cifrato non supportato.');
  const key=keyFromEnv(keyValue);
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64url')),decipher.final()]);
  }catch{
    throw Error('Backup cifrato non valido oppure chiave di cifratura errata.');
  }
}
