import sharp from 'sharp';
import {fail} from './domain.mjs';

export async function normalizeLogo(value){
 if(value==='')return '';
 if(typeof value!=='string'||value.length>710000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))fail('Carica un logo PNG o JPEG di massimo 500 KB.');
 const bytes=Buffer.from(value.split(',')[1],'base64');
 if(bytes.length>500*1024)fail('Il logo supera 500 KB.');
 try{
  const source=sharp(bytes,{limitInputPixels:16000000,failOn:'warning'});
  const meta=await source.metadata();
  if(!['png','jpeg'].includes(meta.format)||meta.pages>1)fail('Formato del logo non supportato.');
  const png=await source.rotate().resize({width:1000,height:500,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  if(png.length>500*1024)fail('Riduci le dimensioni del logo e riprova.');
  return 'data:image/png;base64,'+png.toString('base64');
 }catch(error){if(error.status)throw error;fail('Immagine non valida. Scegli un file PNG o JPEG integro.');}
}
