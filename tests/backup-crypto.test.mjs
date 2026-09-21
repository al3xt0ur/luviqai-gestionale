import '../scripts/test-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptBackup,decryptBackup} from '../server/backup-crypto.mjs';

const key=Buffer.alloc(32,7).toString('base64url');

test('backup cifrato AES-256-GCM: roundtrip e chiave errata rifiutata',()=>{
  const plain=Buffer.from('backup luviqAI di test');
  const envelope=encryptBackup(plain,key);
  assert.equal(envelope.version,1);
  assert.equal(envelope.algorithm,'aes-256-gcm');
  assert.deepEqual(decryptBackup(envelope,key),plain);
  const wrong=Buffer.alloc(32,8).toString('base64url');
  assert.throws(()=>decryptBackup(envelope,wrong),/chiave di cifratura errata/);
});

test('chiave backup deve essere di 32 byte',()=>{
  assert.throws(()=>encryptBackup(Buffer.from('x'),'corta'),/32 byte/);
});
