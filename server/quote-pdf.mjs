import PDFDocument from 'pdfkit';

const euro=n=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n/100);
const states={draft:'Bozza',sent:'Inviato',accepted:'Accettato',rejected:'Rifiutato',cancelled:'Annullato'};
const date=s=>s.split('-').reverse().join('/');

// Generazione locale: nessun browser, servizio esterno o file temporaneo sul server.
export function quotePDF(q){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:48,bufferPages:true,info:{Title:`Preventivo ${q.number}`,Author:q.document.company.name}});
  const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  const width=doc.page.width-96;
  function text(value,size=10,bold=false){doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor('#153e46').text(String(value||''),48,doc.y,{width,lineGap:3});doc.moveDown(.4);}
  function room(height){if(doc.y+height>doc.page.height-80)doc.addPage();}
  text('PREVENTIVO',10,true);text(q.number,23,true);text(states[q.status],10);
  text(q.document.company.name,15,true);text([q.document.company.address,q.document.company.email].filter(Boolean).join('\n'));
  doc.moveDown();text('DESTINATARIO',9,true);text(q.document.client.name,13,true);text([q.document.client.address,q.document.client.email,q.document.client.phone].filter(Boolean).join('\n'));
  text(`Data: ${date(q.issueDate)}    Valido fino al: ${date(q.validUntil)}    Versione: ${q.revision}`);
  text(q.document.title,16,true);
  for(const [i,line] of q.document.lines.entries()){
   doc.font('Helvetica').fontSize(10);room(doc.heightOfString(line.description,{width})+78);
   text(`${i+1}. ${line.description}`,10,true);
   text(`Quantità: ${(line.quantity/100).toLocaleString('it-IT')}  |  Prezzo unitario: ${euro(line.unitPrice)}  |  Sconto: ${line.discount/100}%  |  IVA: ${line.vat/100}%`,9);
   text(`Imponibile: ${euro(line.net)}    IVA: ${euro(line.tax)}    Totale voce: ${euro(line.total)}`,10);
   doc.moveTo(48,doc.y).lineTo(doc.page.width-48,doc.y).strokeColor('#dbe5e3').stroke();doc.moveDown(.8);
  }
  room(105);text(`Imponibile: ${euro(q.net)}`,12);text(`IVA: ${euro(q.tax)}`,12);text(`TOTALE: ${euro(q.total)}`,18,true);
  for(const [label,value] of [['Condizioni',q.document.terms],['Note',q.document.notes]])if(value){room(65);text(label,12,true);text(value);}
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
   doc.switchToPage(i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
   doc.font('Helvetica').fontSize(8).fillColor('#5c7278').text(`Preventivo commerciale · luviqAI · ${q.number} · Pagina ${i+1} di ${range.count}`,48,doc.page.height-35,{width,align:'center',lineBreak:false});doc.page.margins.bottom=bottom;
  }
  doc.end();
 });
}
