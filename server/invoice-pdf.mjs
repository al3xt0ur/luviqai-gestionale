import PDFDocument from 'pdfkit';
const euro=n=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n/100);
const number=n=>n.toLocaleString('it-IT',{maximumFractionDigits:2});
const date=s=>s.split('-').reverse().join('/');
const states={draft:'Bozza',issued:'Emessa',paid:'Pagata',cancelled:'Annullata'};
export function invoicePDF(i){return new Promise((resolve,reject)=>{
 const company=i.document.company,client=i.document.client,doc=new PDFDocument({size:'A4',margin:44,bufferPages:true,info:{Title:`Fattura ${i.number}`,Author:company.name}}),chunks=[];
 doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 const L=44,W=doc.page.width-88,R=L+W,ink='#173c43',muted='#66787b',soft='#f4f7f6',line='#dce6e3',brand=/^#[0-9a-f]{6}$/i.test(company.brandColor||'')?company.brandColor:'#176653';let y=44;
 const text=(v,x,t,w,s=10,b=false,c=ink,a='left')=>{doc.font(b?'Helvetica-Bold':'Helvetica').fontSize(s).fillColor(c).text(String(v||''),x,t,{width:w,align:a,lineGap:2});return doc.y};
 const rule=t=>doc.moveTo(L,t).lineTo(R,t).strokeColor(line).lineWidth(.7).stroke();
 doc.rect(0,0,doc.page.width,7).fill(brand);
 if(company.logoData){try{doc.image(Buffer.from(company.logoData.split(',')[1],'base64'),L,35,{fit:[165,58]});}catch{}}else{text(company.name,L,46,270,17,true,ink);}
 text('FATTURA',R-220,39,220,8,true,muted,'right');text(i.number,R-250,56,250,22,true,ink,'right');text(states[i.status],R-150,86,150,9,true,brand,'right');
 y=116;text(company.name,L,y,280,12,true);y=text(company.address,L,y+20,300,8.5,false,muted)+4;text([company.email,company.phone].filter(Boolean).join(' · '),L,y,320,8.5,false,muted);if(company.taxId)text('P. IVA / C.F. '+company.taxId,L,y+17,320,8.5,false,muted);
 const bx=R-220;doc.roundedRect(bx,116,220,84,10).fill(soft);text('DATA EMISSIONE',bx+14,132,100,7,true,muted);text(date(i.issueDate),bx+118,130,88,9,true,ink,'right');text('SCADENZA',bx+14,157,100,7,true,muted);text(date(i.dueDate),bx+118,155,88,9,true,ink,'right');if(i.quoteId){text('PREVENTIVO',bx+14,182,100,7,true,muted);text('#'+i.quoteId,bx+118,180,88,9,true,ink,'right');}
 y=225;doc.roundedRect(L,y,W,86,10).fill(soft);doc.roundedRect(L,y,5,86,3).fill(brand);text('DESTINATARIO',L+18,y+14,W-36,7,true,brand);text(client.name,L+18,y+32,W-36,13,true);text(client.address,L+18,y+54,W-36,8.5,false,muted);text([client.email,client.phone].filter(Boolean).join(' · '),L+18,y+69,W-36,8.5,false,muted);
 y=338;text(i.document.title,L,y,W,17,true);y+=34;
 const widths=[W-280,42,72,48,40,78];doc.roundedRect(L,y,W,30,6).fill(ink);let x=L;['DESCRIZIONE','QTÀ','PREZZO','SC.','IVA','TOTALE'].forEach((h,n)=>{text(h,x+6,y+10,widths[n]-12,6.5,true,'#fff',n?'right':'left');x+=widths[n]});y+=30;
 for(const [idx,l] of i.document.lines.entries()){const vals=[l.description,number(l.quantity/100),euro(l.unitPrice),number(l.discount/100)+'%',number(l.vat/100)+'%',euro(l.total)];const h=Math.max(38,doc.heightOfString(String(l.description),{width:widths[0]-12})+18);if(idx%2===0)doc.rect(L,y,W,h).fill('#f8faf9');x=L;vals.forEach((v,n)=>{text(v,x+6,y+10,widths[n]-12,8.2,n===5,ink,n?'right':'left');x+=widths[n]});y+=h;rule(y);}
 y+=22;const boxW=250,bx2=R-boxW;doc.roundedRect(bx2,y,boxW,105,10).fill(soft);text('Imponibile',bx2+16,y+16,105,9);text(euro(i.net),bx2+125,y+15,108,10,true,ink,'right');text('IVA',bx2+16,y+40,105,9);text(euro(i.tax),bx2+125,y+39,108,10,true,ink,'right');doc.roundedRect(bx2+10,y+66,boxW-20,30,8).fill(ink);text('TOTALE',bx2+22,y+76,80,8,true,'#fff');text(euro(i.total),bx2+105,y+72,boxW-127,15,true,'#fff','right');
 if(i.status==='paid'){const pay=typeof i.payment==='string'?JSON.parse(i.payment):i.payment||{};text('PAGAMENTO REGISTRATO',L,y+12,210,7,true,brand);text([pay.date&&date(pay.date),pay.method,pay.reference].filter(Boolean).join(' · '),L,y+31,235,9,false,muted);}
 y+=132;if(i.document.notes){text('NOTE',L,y,W,7,true,brand);text(i.document.notes,L,y+18,W,9,false,muted);}
 const range=doc.bufferedPageRange();for(let p=0;p<range.count;p++){doc.switchToPage(p);rule(doc.page.height-48);text(company.name,L,doc.page.height-36,W-200,7,true,muted);text(`Fattura ${i.number} · ${p+1}/${range.count}`,R-200,doc.page.height-36,200,7,false,muted,'right');}
 doc.end();
});}
