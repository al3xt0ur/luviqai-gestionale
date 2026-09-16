import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normalizeLogo} from '../server/logo.mjs';
import {connectStore,migrate} from '../server/storage.mjs';
import {provision} from '../server/auth.mjs';
import {mutate,snapshot} from '../server/domain.mjs';

test('logo: validazione reale, normalizzazione, isolamento e snapshot del preventivo',async()=>{
 const png=await sharp({create:{width:200,height:80,channels:4,background:'#176653'}}).png().toBuffer();
 const logo='data:image/png;base64,'+png.toString('base64');
 assert((await normalizeLogo(logo)).startsWith('data:image/png;base64,'));
 assert.equal(await normalizeLogo(''),'');
 for(const input of ['https://example.com/logo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YWJj',logo+'x'.repeat(720000)])await assert.rejects(normalizeLogo(input));
 const huge=await sharp({create:{width:4100,height:4100,channels:3,background:'#ffffff'}}).png().toBuffer();
 await assert.rejects(normalizeLogo('data:image/png;base64,'+huge.toString('base64')),/Immagine/);
 const db=await connectStore();try{
  await migrate(db);
  const a=await provision(db,{slug:'logo-a',name:'Impresa A',email:'a@example.com',password:'Password-logo-2026!'});
  const b=await provision(db,{slug:'logo-b',name:'Impresa B',email:'b@example.com',password:'Password-logo-2026!'});
  const run=(action,input)=>mutate(db,a,action,input,crypto.randomUUID());
  const company={name:'Impresa A',logoText:'IA',brandColor:'#176653',logoData:logo,phone:'000',website:'example.com',taxId:'DEMO'};
  await run('company',company);assert.equal((await snapshot(db,b)).company.logoData,'');
  const saved=(await snapshot(db,a)).company.logoData;assert(saved);
  const client=(await run('client',{name:'Cliente'})).value;
  const quote=(await run('quote',{clientId:client.id,title:'Con logo',issueDate:'2026-09-16',validUntil:'2099-01-01',lines:[{description:'Servizio',quantity:100,unitPrice:1000,vat:0}]})).value;
  await run('company',{...company,logoData:''});
  assert.equal((await snapshot(db,a)).company.logoData,'');
  assert.equal((await snapshot(db,a)).quotes[0].document.company.logoData,saved);
  assert.equal(quote.document.company.taxId,'DEMO');
  await assert.rejects(mutate(db,{...a,role:'operator'},'company',company,crypto.randomUUID()),/account/);
 }finally{await db.close();}
});
