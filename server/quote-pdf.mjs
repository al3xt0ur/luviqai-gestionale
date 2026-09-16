import PDFDocument from 'pdfkit';

const euro=n=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n/100);
const number=n=>n.toLocaleString('it-IT',{maximumFractionDigits:2});
const states={draft:'Bozza',sent:'Inviato',accepted:'Accettato',rejected:'Rifiutato',cancelled:'Annullato'};
const date=s=>s.split('-').reverse().join('/');

// Preventivo A4: layout commerciale pulito, multipagina e coerente con il brand aziendale.
export function quotePDF(q){
 return new Promise((resolve,reject)=>{
  const company=q.document.company,client=q.document.client;
  const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`Preventivo ${q.number}`,Author:company.name}});
  const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);

  const L=42,W=doc.page.width-84,R=L+W;
  const ink='#173c43',muted='#62777b',soft='#f4f7f6',line='#dce6e3',white='#ffffff';
  const brand=/^#[0-9a-f]{6}$/i.test(company.brandColor||'')?company.brandColor:'#176653';
  const footerY=doc.page.height-48;
  let y=42;

  function font(size=10,bold=false){doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);}
  function height(value,width,size=10,bold=false,lineGap=2){font(size,bold);return doc.heightOfString(String(value||''),{width,lineGap});}
  function text(value,x,top,width,size=10,bold=false,color=ink,align='left',lineGap=2){
   font(size,bold);doc.fillColor(color).text(String(value||''),x,top,{width,align,lineGap});
   return doc.y;
  }
  function rule(top,x=L,width=W,color=line,thickness=.6){doc.moveTo(x,top).lineTo(x+width,top).strokeColor(color).lineWidth(thickness).stroke();}
  function pill(label,x,top,{bg=soft,fg=brand}={}){
   font(8,true);const w=doc.widthOfString(label)+22;
   doc.roundedRect(x-w,top,w,22,11).fill(bg);text(label,x-w+8,top+7,w-16,8,true,fg,'center');
   return w;
  }
  function room(h){if(y+h>footerY-14)newPage();}
  function newPage(){
   doc.addPage();
   doc.rect(0,0,doc.page.width,5).fill(brand);
   text(company.name,L,25,W-210,9,true,ink);
   text(q.number,R-190,25,190,9,true,muted,'right');
   rule(49);
   y=70;
  }

  // Fascia brand e testata.
  doc.rect(0,0,doc.page.width,7).fill(brand);
  const logoTop=35;
  if(company.logoData){
   try{doc.image(Buffer.from(company.logoData.split(',')[1],'base64'),L,logoTop,{fit:[170,62],align:'left',valign:'center'});}catch{}
  } else {
   doc.roundedRect(L,logoTop,52,52,12).fill(brand);
   const initials=company.name.split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();
   text(initials,L+4,logoTop+16,44,18,true,white,'center');
  }

  text('PREVENTIVO',R-220,38,220,8,true,muted,'right');
  text(q.number,R-250,55,250,23,true,ink,'right');
  pill(states[q.status],R,88);

  // Dati aziendali e scheda metadati.
  let companyY=company.logoData?108:100;
  companyY=text(company.name,L,companyY,285,13,true,ink)+6;
  const contacts=[company.address,[company.email,company.phone].filter(Boolean).join('  ·  '),company.website,company.taxId?'P. IVA / C.F. '+company.taxId:''].filter(Boolean);
  for(const row of contacts){companyY=text(row,L,companyY,300,8.5,false,muted)+3;}

  const metaX=R-212,metaY=126,metaW=212,metaH=92;
  doc.roundedRect(metaX,metaY,metaW,metaH,10).fill(soft);
  const meta=[['DATA',date(q.issueDate)],['VALIDITÀ',date(q.validUntil)],['VERSIONE',String(q.revision)]];
  meta.forEach(([label,value],i)=>{
   const yy=metaY+14+i*25;
   text(label,metaX+14,yy,78,7,true,muted);
   text(value,metaX+92,yy-1,metaW-106,9,true,ink,'right');
  });
  y=Math.max(companyY,metaY+metaH)+28;

  // Destinatario.
  const recipientRows=[client.address,[client.email,client.phone].filter(Boolean).join('  ·  ')].filter(Boolean);
  const clientNameH=height(client.name,W-40,13,true);
  const recipientH=recipientRows.reduce((sum,row)=>sum+height(row,W-40,8.5)+3,0);
  const clientBoxH=47+clientNameH+recipientH;
  room(clientBoxH);
  doc.roundedRect(L,y,W,clientBoxH,10).fill(soft);
  doc.roundedRect(L,y,5,clientBoxH,3).fill(brand);
  text('DESTINATARIO',L+18,y+14,W-36,7,true,brand);
  let cy=text(client.name,L+18,y+31,W-36,13,true,ink)+5;
  for(const row of recipientRows){cy=text(row,L+18,cy,W-36,8.5,false,muted)+3;}
  y+=clientBoxH+26;

  // Oggetto del preventivo.
  text('PROPOSTA COMMERCIALE',L,y,W,7,true,brand);
  y=text(q.document.title,L,y+14,W,18,true,ink)+10;
  text('Di seguito il dettaglio economico dei servizi proposti.',L,y,W,9,false,muted);
  y+=26;

  // Tabella voci.
  const widths=[W-310,42,73,52,43,100];
  function tableHeader(){
   doc.roundedRect(L,y,W,30,6).fill(ink);
   let x=L;
   ['SERVIZIO / DESCRIZIONE','QTÀ','PREZZO','SCONTO','IVA','IMPONIBILE'].forEach((label,i)=>{
    text(label,x+7,y+10,widths[i]-14,6.6,true,white,i?'right':'left');x+=widths[i];
   });
   y+=30;
  }
  room(70);tableHeader();
  for(const [index,item]of q.document.lines.entries()){
   const values=[item.description,number(item.quantity/100),euro(item.unitPrice),number(item.discount/100)+'%',number(item.vat/100)+'%',euro(item.net)];
   const rowHeight=Math.max(42,...values.map((v,i)=>height(v,widths[i]-14,8.5,i===5)+20));
   if(y+rowHeight>footerY-10){newPage();tableHeader();}
   if(index%2===0)doc.rect(L,y,W,rowHeight).fill('#f8faf9');
   let x=L;
   values.forEach((v,i)=>{text(v,x+7,y+10,widths[i]-14,8.5,i===5,ink,i?'right':'left');x+=widths[i];});
   y+=rowHeight;rule(y);
  }
  y+=22;

  // Riepilogo IVA + totale, affiancati quando possibile.
  const taxGroups=new Map();
  for(const item of q.document.lines){const g=taxGroups.get(item.vat)||{net:0,tax:0};g.net+=item.net;g.tax+=item.tax;taxGroups.set(item.vat,g);}
  const summaryH=Math.max(124,taxGroups.size*17+44);
  room(summaryH+8);

  text('RIEPILOGO IVA',L,y+3,220,7,true,muted);
  let sy=y+25;
  for(const [rate,values]of taxGroups){
   text(`Aliquota ${number(rate/100)}%`,L,sy,95,8.5,true,ink);
   text(`${euro(values.net)} + ${euro(values.tax)} IVA`,L+98,sy,145,8.5,false,muted,'right');
   sy+=18;
  }

  const boxW=252,boxX=R-boxW;
  doc.roundedRect(boxX,y,boxW,summaryH,12).fill(soft);
  text('RIEPILOGO ECONOMICO',boxX+16,y+15,boxW-32,7,true,muted);
  text('Imponibile',boxX+16,y+39,100,9,false,ink);text(euro(q.net),boxX+116,y+38,boxW-132,10,true,ink,'right');
  text('IVA',boxX+16,y+61,100,9,false,ink);text(euro(q.tax),boxX+116,y+60,boxW-132,10,true,ink,'right');
  doc.roundedRect(boxX+10,y+82,boxW-20,summaryH-92,9).fill(ink);
  text('TOTALE',boxX+24,y+96,72,8,true,white);
  text(euro(q.total),boxX+92,y+90,boxW-116,18,true,white,'right');
  y+=summaryH+28;

  // Condizioni e note in box separati.
  for(const [label,value]of [['CONDIZIONI E PAGAMENTO',q.document.terms],['NOTE',q.document.notes]])if(value){
   const content=String(value).trim();
   const h=height(content,W-36,9,false,3)+47;
   if(h<footerY-90-y){
    room(h);
    doc.roundedRect(L,y,W,h,9).lineWidth(.7).strokeColor(line).stroke();
    text(label,L+16,y+13,W-32,7,true,brand);
    text(content,L+16,y+31,W-32,9,false,muted,'left',3);
    y+=h+16;
   } else {
    room(48);text(label,L,y,W,7,true,brand);y+=20;
    for(const paragraph of content.split('\n')){
     const ph=height(paragraph||' ',W,9,false,3);room(ph+7);text(paragraph,L,y,W,9,false,muted,'left',3);y+=ph+7;
    }
    y+=10;
   }
  }

  // Footer su tutte le pagine.
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
   doc.switchToPage(i);
   rule(footerY);
   const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
   text(company.name,L,footerY+11,W-210,7,true,muted);
   text(`Preventivo ${q.number}  ·  ${i+1} / ${range.count}`,R-210,footerY+11,210,7,false,muted,'right');
   doc.page.margins.bottom=bottom;
  }
  doc.end();
 });
}
