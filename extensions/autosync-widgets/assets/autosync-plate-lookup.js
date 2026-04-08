(function(){document.querySelectorAll("[data-apl-root]").forEach(function(R){if(!R)return;var P=R.dataset.proxyUrl,L=R.dataset.logoUrl,LE=R.querySelector('[data-apl-loading]'),EE=R.querySelector('[data-apl-error]'),RE=R.querySelector('[data-apl-results]'),I=R.querySelector('[data-apl-input]'),B=R.querySelector('[data-apl-submit]'),RB=R.querySelector('[data-apl-retry]'),BH=B?B.innerHTML:'',lr='',HD=R.querySelector('[data-apl-history]'),HK='autosync_plate_history';
var contentEl=R.querySelector('[data-apl-content]'),formSideEl=R.querySelector('[data-apl-form-side]'),containerEl=R.querySelector('.apl-container');
var origContentHTML=contentEl?contentEl.innerHTML:'';
var origFormSideHTML=formSideEl?formSideEl.innerHTML:'';
if(!I||!B)return;
function gH(){try{var h=JSON.parse(localStorage.getItem(HK));return Array.isArray(h)?h:[];}catch(e){return[];}}
function aH(r,v){try{var h=gH();h=h.filter(function(x){return x.r!==r;});h.unshift({r:r,mk:v.make||'',md:v.model||''});if(h.length>8)h=h.slice(0,8);localStorage.setItem(HK,JSON.stringify(h));}catch(e){}}
function sHist(){if(!HD)return;var h=gH();if(!h.length){HD.style.display='none';return;}while(HD.firstChild)HD.removeChild(HD.firstChild);var lb=el('span','apl-history__label','Recent:');HD.appendChild(lb);for(var i=0;i<h.length;i++){(function(x){var it=el('button','apl-history__item');it.type='button';it.appendChild(el('span','apl-history__reg',fR(x.r)));if(x.mk)it.appendChild(el('span','apl-history__vehicle',x.mk+(x.md?' '+x.md:'')));it.addEventListener('click',function(){I.value=fR(x.r);lr=x.r;doL(x.r);HD.style.display='none';});HD.appendChild(it);})(h[i]);}HD.style.display='flex';}
I.addEventListener('input',function(){this.value=this.value.toUpperCase().replace(/[^A-Z0-9 ]/g,'');});
I.addEventListener('keydown',function(e){if(e.key==='Enter')B.click();});
if(RB)RB.addEventListener('click',function(){if(lr)doL(lr);});
B.addEventListener('click',function(){var r=I.value.trim().replace(/\s+/g,'');if(r.length<2)return;lr=r;doL(r);});
function doL(r){B.disabled=true;B.textContent='Looking up...';EE.style.display='none';RE.style.display='none';LE.style.display='flex';if(containerEl)containerEl.style.display='none';
fetch(P+'?path=plate-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({registration:r})})
.then(function(x){return x.json();}).then(function(d){B.disabled=false;B.innerHTML=BH;LE.style.display='none';if(containerEl)containerEl.style.display='';if(d.error){sE(d.error);return;}if(d.vehicle)rR(d.vehicle,d.motHistory,d.resolved||null,r);})
.catch(function(){B.disabled=false;B.innerHTML=BH;LE.style.display='none';if(containerEl)containerEl.style.display='';sE('Failed to look up registration. Please try again.');});}
function sE(m){var x=EE.querySelector('[data-apl-error-msg]');if(x)x.textContent=m;EE.style.display='block';RE.style.display='none';}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined&&x!==null)e.textContent=String(x);return e;}
function si(m){var t=document.createElement('template');t.innerHTML=m.trim();return t.content.firstChild;}
var IC={cd:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
cs:'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
ar:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
cl:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'};

/* Compact result: two-column layout inside container */
function rRC(v,mH,rv,rg){
while(RE.firstChild)RE.removeChild(RE.firstChild);
/* Replace left column (content) with vehicle info */
if(contentEl){
contentEl.innerHTML='';
var vInfo=el('div','apl-result-vehicle');
/* Plate badge */
var plateBadge=el('div','apl-result-vehicle__plate');plateBadge.appendChild(el('span','apl-result-vehicle__plate-flag','GB'));plateBadge.appendChild(el('span','apl-result-vehicle__plate-text',fR(rg)));vInfo.appendChild(plateBadge);
/* Make/Model */
vInfo.appendChild(el('h3','apl-result-vehicle__make',(v.make||'')+' '+(v.model||'')));
/* Specs line */
var specs=[];if(v.yearOfManufacture)specs.push(v.yearOfManufacture);if(v.engineCapacity)specs.push(v.engineCapacity+'cc');if(v.fuelType&&v.fuelType!=='Unknown')specs.push(v.fuelType);
if(specs.length)vInfo.appendChild(el('p','apl-result-vehicle__specs',specs.join(' \u00B7 ')));
/* MOT/Tax status dots */
if(R.dataset.showTax!=='false'){
var sts=el('div','apl-result-vehicle__statuses');
sts.appendChild(mSInline('MOT',v.motStatus));
sts.appendChild(mSInline('Tax',v.taxStatus));
vInfo.appendChild(sts);}
contentEl.appendChild(vInfo);
}
/* Replace right column (form side) with action buttons */
if(formSideEl){
formSideEl.innerHTML='';
var acts=el('div','apl-result-actions');
/* Find Parts button */
var findBtn=el('button','apl-result-actions__find');findBtn.type='button';findBtn.textContent='Find Parts \u2192';
var useMd=(rv&&rv.modelName)?rv.modelName:(v.model||'');
findBtn.addEventListener('click',function(){findBtn.disabled=true;findBtn.textContent='Finding...';var mk=v.make;
fetch(P+'?path=collection-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({make:mk,model:useMd})})
.then(function(r){return r.json();}).then(function(d){if(d.data&&d.data.found&&d.data.url)window.location.href=d.data.url;else window.location.href='/collections/'+mk.toLowerCase().replace(/\s+/g,'-')+'-'+useMd.toLowerCase().replace(/\s+/g,'-')+'-parts';})
.catch(function(){window.location.href='/collections/'+v.make.toLowerCase().replace(/\s+/g,'-')+'-'+useMd.toLowerCase().replace(/\s+/g,'-')+'-parts';});});
acts.appendChild(findBtn);
/* Button row: View Details + New Search */
var row=el('div','apl-result-actions__row');
var detailsBtn=el('button','apl-result-actions__details');detailsBtn.type='button';detailsBtn.textContent='View Details';
detailsBtn.addEventListener('click',function(){openModal(v,mH,rv,rg);});
row.appendChild(detailsBtn);
var newBtn=el('button','apl-result-actions__new');newBtn.type='button';newBtn.textContent='New Search';
newBtn.addEventListener('click',function(){restoreInitial();});
row.appendChild(newBtn);
acts.appendChild(row);
formSideEl.appendChild(acts);
}
/* Garage, history, YMME population */
sG(v,rv,rg);
/* Footer watermark */
if(R.dataset.hideWatermark!=='true'){appendFooter(RE);}
RE.style.display='block';
}

/* Restore initial state (heading + form) */
function restoreInitial(){
if(contentEl)contentEl.innerHTML=origContentHTML;
if(formSideEl){formSideEl.innerHTML=origFormSideHTML;
/* Re-bind the elements inside restored form side */
I=R.querySelector('[data-apl-input]');B=R.querySelector('[data-apl-submit]');HD=R.querySelector('[data-apl-history]');
if(I){I.addEventListener('input',function(){this.value=this.value.toUpperCase().replace(/[^A-Z0-9 ]/g,'');});
I.addEventListener('keydown',function(e){if(e.key==='Enter')B.click();});I.value='';I.focus();}
if(B){BH=B.innerHTML;B.addEventListener('click',function(){var r=I.value.trim().replace(/\s+/g,'');if(r.length<2)return;lr=r;doL(r);});}
sHist();}
RE.style.display='none';
}

/* Inline status dot (small, for result vehicle info) */
function mSInline(lb,st){
var w=el('div','apl-st');var s=st||'Unknown';
var c='apl-st--valid';
if(lb==='MOT')c=s==='Valid'?'apl-st--valid':s==='Not valid'?'apl-st--invalid':'apl-st--warn';
else c=s==='Taxed'?'apl-st--valid':s==='SORN'?'apl-st--warn':'apl-st--invalid';
var bg=el('div',c),bd=el('span','apl-st__badge');
bd.appendChild(el('span','apl-st__dot'));bd.appendChild(document.createTextNode(lb+': '+s));bg.appendChild(bd);w.appendChild(bg);return w;
}

/* Footer watermark helper */
function appendFooter(parent){
var ft=el('div','apl-footer');ft.style.cssText='display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;padding:12px 0 0!important;margin-top:16px!important;font-size:11px!important;color:#9ca3af!important;opacity:0.5!important;';
var lo=document.createElement('img');lo.src=L;lo.alt='AutoSync';lo.width=14;lo.height=14;lo.style.cssText='width:14px!important;height:14px!important;max-width:14px!important;max-height:14px!important;display:inline-block!important;flex-shrink:0!important;';ft.appendChild(lo);
var pw=el('span');pw.textContent='Powered by ';pw.appendChild(el('strong','','AutoSync'));ft.appendChild(pw);parent.appendChild(ft);
}

/* Modal: Vehicle Details overlay */
function openModal(v,mH,rv,rg){
/* Remove existing modal if any */
var existing=document.querySelector('.apl-modal-backdrop');if(existing)existing.remove();
var backdrop=el('div','apl-modal-backdrop');
var modal=el('div','apl-modal');
/* Header */
var hdr=el('div','apl-modal__header');
var titleEl=el('h3','apl-modal__title');
/* Mini plate in title */
var titlePlate=el('span','apl-result-vehicle__plate');titlePlate.appendChild(el('span','apl-result-vehicle__plate-flag','GB'));titlePlate.appendChild(el('span','apl-result-vehicle__plate-text',fR(rg)));
titleEl.appendChild(titlePlate);titleEl.appendChild(document.createTextNode(' '+(v.make||'')+' '+(v.model||'')));
hdr.appendChild(titleEl);
var closeBtn=el('button','apl-modal__close');closeBtn.type='button';closeBtn.textContent='\u2715';
closeBtn.addEventListener('click',function(){backdrop.remove();});
hdr.appendChild(closeBtn);modal.appendChild(hdr);
/* Body */
var body=el('div','apl-modal__body');
/* Full vehicle details grid */
var dt=el('div','apl-details'),dg=el('div','apl-details__grid'),di=[];
if(v.yearOfManufacture)di.push(['Year',String(v.yearOfManufacture)]);
if(v.colour&&v.colour!=='Unknown')di.push(['Colour',v.colour]);
if(v.fuelType&&v.fuelType!=='Unknown')di.push(['Fuel Type',v.fuelType]);
if(v.engineCapacity)di.push(['Engine',v.engineCapacity+'cc']);
if(v.co2Emissions)di.push(['CO\u2082 Emissions',v.co2Emissions+' g/km']);
if(v.typeApproval)di.push(['Type Approval',v.typeApproval]);
if(v.wheelplan)di.push(['Wheelplan',v.wheelplan]);
if(v.revenueWeight)di.push(['Weight',v.revenueWeight+' kg']);
if(mH&&mH.firstUsedDate)di.push(['First Registered',fD(mH.firstUsedDate)]);
if(v.markedForExport)di.push(['Export','Marked for export']);
if(di.length%2!==0)di.push(['','']);
for(var i=0;i<di.length;i++){if(!di[i][0]){dg.appendChild(el('div','apl-details__item'));continue;}
var it=el('div','apl-details__item');it.appendChild(el('span','apl-details__label',di[i][0]));it.appendChild(el('span','apl-details__value',di[i][1]));dg.appendChild(it);}
dt.appendChild(dg);body.appendChild(dt);
/* MOT & Tax statuses */
if(R.dataset.showTax!=='false'){var st=el('div','apl-statuses');st.appendChild(mS('MOT',v.motStatus,v.motExpiryDate,'Expires'));st.appendChild(mS('Tax',v.taxStatus,v.taxDueDate,'Due'));body.appendChild(st);}
/* MOT History */
var ts=(mH&&mH.motTests)?mH.motTests:[];
if(R.dataset.showMot!=='false'&&ts.length>0){
var ms=el('div','apl-mot');ms.style.maxWidth='100%';ms.style.margin='0';ms.style.padding='16px 24px';ms.style.animation='none';
var tg=el('button','apl-mot__toggle');tg.appendChild(si(IC.cl));tg.appendChild(el('span','apl-mot__title','MOT History'));tg.appendChild(el('span','apl-mot__count',ts.length+' test'+(ts.length!==1?'s':'')));
var cv=el('span','apl-mot__chev');cv.appendChild(si(IC.cd));tg.appendChild(cv);ms.appendChild(tg);
var ls=el('ul','apl-mot__list'),s5=ts.length>5,vis=s5?5:ts.length;
for(var ti=0;ti<ts.length;ti++){var t=ts[ti],ps=t.testResult==='PASSED',li=el('li','');if(ti>=vis)li.style.display='none';li.dataset.motIdx=ti;
var hd=t.defects&&t.defects.length>0,rw=el('div','apl-mot__row'+(hd?' apl-mot__row--click':''));
rw.appendChild(el('span','apl-mot__date',fD(t.completedDate)));
var bg2=el('span','apl-mot__badge '+(ps?'apl-mot__badge--pass':'apl-mot__badge--fail'));bg2.appendChild(el('span','apl-st__dot'));bg2.appendChild(document.createTextNode(ps?'Pass':'Fail'));rw.appendChild(bg2);
if(t.odometerValue&&t.odometerValue!=='0')rw.appendChild(el('span','apl-mot__miles',Number(t.odometerValue).toLocaleString()+' '+(t.odometerUnit||'mi')));
if(hd){var rc=el('span','apl-mot__rchev');rc.appendChild(si(IC.cs));rw.appendChild(rc);}li.appendChild(rw);
if(hd){var dd=el('div','apl-mot__defects');for(var di2=0;di2<t.defects.length;di2++){var df=t.defects[di2],dty=(df.type||'advisory').toLowerCase(),de=el('div','apl-defect apl-defect--'+dty);de.appendChild(el('span','apl-defect__type',df.type||'Advisory'));de.appendChild(document.createTextNode(df.text||''));dd.appendChild(de);}
li.appendChild(dd);(function(r2,d2){r2.addEventListener('click',function(){d2.classList.toggle('apl-mot__defects--open');var c2=r2.querySelector('.apl-mot__rchev');if(c2)c2.classList.toggle('apl-mot__rchev--open');});})(rw,dd);}
ls.appendChild(li);}
if(s5){var sa=el('button','apl-mot__showall','Show all '+ts.length+' tests');sa.addEventListener('click',function(){var its=ls.querySelectorAll('li');for(var j=0;j<its.length;j++)its[j].style.display='';this.style.display='none';});var sl=el('li','');sl.appendChild(sa);ls.appendChild(sl);}
ms.appendChild(ls);tg.addEventListener('click',function(){tg.classList.toggle('apl-mot__toggle--open');ls.classList.toggle('apl-mot__list--open');});body.appendChild(ms);}
modal.appendChild(body);backdrop.appendChild(modal);
/* Close on backdrop click */
backdrop.addEventListener('click',function(e){if(e.target===backdrop)backdrop.remove();});
/* Close on Escape */
function escHandler(e){if(e.key==='Escape'){backdrop.remove();document.removeEventListener('keydown',escHandler);}}
document.addEventListener('keydown',escHandler);
document.body.appendChild(backdrop);
}

/* Expanded/classic result (fallback mode) */
function rR(v,mH,rv,rg){while(RE.firstChild)RE.removeChild(RE.firstChild);
var resultStyle=R.dataset.resultStyle||'compact';if(resultStyle==='compact'){rRC(v,mH,rv,rg);return;}
/* Hide container for expanded mode */
if(containerEl)containerEl.style.display='none';
var card=el('div','apl-card');
/* Close/dismiss button */
var closeBtn=el('button','apl-card__close');closeBtn.type='button';closeBtn.title='Close';
var closeSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');closeSvg.setAttribute('width','18');closeSvg.setAttribute('height','18');closeSvg.setAttribute('viewBox','0 0 24 24');closeSvg.setAttribute('fill','none');closeSvg.setAttribute('stroke','currentColor');closeSvg.setAttribute('stroke-width','2.5');closeSvg.setAttribute('stroke-linecap','round');closeSvg.setAttribute('stroke-linejoin','round');
var l1=document.createElementNS('http://www.w3.org/2000/svg','line');l1.setAttribute('x1','18');l1.setAttribute('y1','6');l1.setAttribute('x2','6');l1.setAttribute('y2','18');closeSvg.appendChild(l1);
var l2=document.createElementNS('http://www.w3.org/2000/svg','line');l2.setAttribute('x1','6');l2.setAttribute('y1','6');l2.setAttribute('x2','18');l2.setAttribute('y2','18');closeSvg.appendChild(l2);
closeBtn.appendChild(closeSvg);
closeBtn.addEventListener('click',function(){RE.style.display='none';if(containerEl)containerEl.style.display='';restoreInitial();});
card.appendChild(closeBtn);
var hdr=el('div','apl-card__header'),rb=el('div','apl-card__reg');
rb.appendChild(el('span','apl-card__reg-flag','GB'));rb.appendChild(el('span','apl-card__reg-text',fR(rg)));hdr.appendChild(rb);
hdr.appendChild(el('h2','apl-card__title',(v.make||'')+' '+(v.model||'')));
var sb=[];if(v.yearOfManufacture)sb.push(v.yearOfManufacture);if(v.colour)sb.push(v.colour);if(v.fuelType&&v.fuelType!=='Unknown')sb.push(v.fuelType);
if(sb.length)hdr.appendChild(el('p','apl-card__subtitle',sb.join(' \u2022 ')));card.appendChild(hdr);
/* Full vehicle details */
var dt=el('div','apl-details'),dg=el('div','apl-details__grid'),di=[];
if(v.yearOfManufacture)di.push(['Year',String(v.yearOfManufacture)]);
if(v.colour&&v.colour!=='Unknown')di.push(['Colour',v.colour]);
if(v.fuelType&&v.fuelType!=='Unknown')di.push(['Fuel Type',v.fuelType]);
if(v.engineCapacity)di.push(['Engine',v.engineCapacity+'cc']);
if(v.co2Emissions)di.push(['CO\u2082 Emissions',v.co2Emissions+' g/km']);
if(v.typeApproval)di.push(['Type Approval',v.typeApproval]);
if(v.wheelplan)di.push(['Wheelplan',v.wheelplan]);
if(v.revenueWeight)di.push(['Weight',v.revenueWeight+' kg']);
if(mH&&mH.firstUsedDate)di.push(['First Registered',fD(mH.firstUsedDate)]);
if(v.markedForExport)di.push(['Export','Marked for export']);
if(di.length%2!==0)di.push(['','']);
for(var i=0;i<di.length;i++){if(!di[i][0]){dg.appendChild(el('div','apl-details__item'));continue;}
var it=el('div','apl-details__item');it.appendChild(el('span','apl-details__label',di[i][0]));it.appendChild(el('span','apl-details__value',di[i][1]));dg.appendChild(it);}
dt.appendChild(dg);card.appendChild(dt);
/* MOT & Tax */
if(R.dataset.showTax!=='false'){var st=el('div','apl-statuses');st.appendChild(mS('MOT',v.motStatus,v.motExpiryDate,'Expires'));st.appendChild(mS('Tax',v.taxStatus,v.taxDueDate,'Due'));card.appendChild(st);}
RE.appendChild(card);sG(v,rv,rg);
/* Find Parts */
if(v.make){var fw=el('div','apl-find-wrap'),fb=el('button','apl-find-btn');fb.appendChild(document.createTextNode('Find Parts for This Vehicle '));fb.appendChild(si(IC.ar));
var useMd=(rv&&rv.modelName)?rv.modelName:(v.model||'');
fb.addEventListener('click',function(){fb.disabled=true;fb.textContent='Finding parts...';var mk=v.make;
fetch(P+'?path=collection-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({make:mk,model:useMd})})
.then(function(r){return r.json();}).then(function(d){if(d.data&&d.data.found&&d.data.url)window.location.href=d.data.url;else window.location.href='/collections/'+mk.toLowerCase().replace(/\s+/g,'-')+'-'+useMd.toLowerCase().replace(/\s+/g,'-')+'-parts';})
.catch(function(){window.location.href='/collections/'+v.make.toLowerCase().replace(/\s+/g,'-')+'-'+useMd.toLowerCase().replace(/\s+/g,'-')+'-parts';});});
fw.appendChild(fb);RE.appendChild(fw);}
/* MOT History */
var ts=(mH&&mH.motTests)?mH.motTests:[];
if(R.dataset.showMot!=='false'&&ts.length>0){var ms=el('div','apl-mot'),tg=el('button','apl-mot__toggle');tg.appendChild(si(IC.cl));tg.appendChild(el('span','apl-mot__title','MOT History'));tg.appendChild(el('span','apl-mot__count',ts.length+' test'+(ts.length!==1?'s':'')));
var cv=el('span','apl-mot__chev');cv.appendChild(si(IC.cd));tg.appendChild(cv);ms.appendChild(tg);
var ls=el('ul','apl-mot__list'),s5=ts.length>5,vis=s5?5:ts.length;
for(var ti=0;ti<ts.length;ti++){var t=ts[ti],ps=t.testResult==='PASSED',li=el('li','');if(ti>=vis)li.style.display='none';li.dataset.motIdx=ti;
var hd=t.defects&&t.defects.length>0,rw=el('div','apl-mot__row'+(hd?' apl-mot__row--click':''));
rw.appendChild(el('span','apl-mot__date',fD(t.completedDate)));
var bg2=el('span','apl-mot__badge '+(ps?'apl-mot__badge--pass':'apl-mot__badge--fail'));bg2.appendChild(el('span','apl-st__dot'));bg2.appendChild(document.createTextNode(ps?'Pass':'Fail'));rw.appendChild(bg2);
if(t.odometerValue&&t.odometerValue!=='0')rw.appendChild(el('span','apl-mot__miles',Number(t.odometerValue).toLocaleString()+' '+(t.odometerUnit||'mi')));
if(hd){var rc=el('span','apl-mot__rchev');rc.appendChild(si(IC.cs));rw.appendChild(rc);}li.appendChild(rw);
if(hd){var dd=el('div','apl-mot__defects');for(var di2=0;di2<t.defects.length;di2++){var df=t.defects[di2],dty=(df.type||'advisory').toLowerCase(),de=el('div','apl-defect apl-defect--'+dty);de.appendChild(el('span','apl-defect__type',df.type||'Advisory'));de.appendChild(document.createTextNode(df.text||''));dd.appendChild(de);}
li.appendChild(dd);(function(r2,d2){r2.addEventListener('click',function(){d2.classList.toggle('apl-mot__defects--open');var c2=r2.querySelector('.apl-mot__rchev');if(c2)c2.classList.toggle('apl-mot__rchev--open');});})(rw,dd);}
ls.appendChild(li);}
if(s5){var sa=el('button','apl-mot__showall','Show all '+ts.length+' tests');sa.addEventListener('click',function(){var its=ls.querySelectorAll('li');for(var j=0;j<its.length;j++)its[j].style.display='';this.style.display='none';});var sl=el('li','');sl.appendChild(sa);ls.appendChild(sl);}
ms.appendChild(ls);tg.addEventListener('click',function(){tg.classList.toggle('apl-mot__toggle--open');ls.classList.toggle('apl-mot__list--open');});RE.appendChild(ms);}
/* Footer */
if(R.dataset.hideWatermark!=='true'){appendFooter(RE);}RE.style.display='block';}
function mS(lb,st,da,dl){var w=el('div','apl-st'),inn=el('div');inn.appendChild(el('span','apl-st__label',lb));var s=st||'Unknown',c='apl-st--valid';
if(lb==='MOT')c=s==='Valid'?'apl-st--valid':s==='Not valid'?'apl-st--invalid':'apl-st--warn';
else c=s==='Taxed'?'apl-st--valid':s==='SORN'?'apl-st--warn':'apl-st--invalid';
var bg=el('div',c),bd=el('span','apl-st__badge');bd.appendChild(el('span','apl-st__dot'));bd.appendChild(document.createTextNode(s));bg.appendChild(bd);
if(da)bg.appendChild(el('p','apl-st__sub',dl+': '+fD(da)));inn.appendChild(bg);w.appendChild(inn);return w;}
function sG(v,rv,rg){try{var K='autosync_garage',g=[];var rw=localStorage.getItem(K);if(rw)g=JSON.parse(rw);if(!Array.isArray(g))g=[];
var ymmeMake=(rv&&rv.makeName)?rv.makeName:(v.make||'');
var ymmeModel=(rv&&rv.modelName)?rv.modelName:(v.model||'');
var e={makeName:ymmeMake,modelName:ymmeModel,year:String(v.yearOfManufacture||''),colour:v.colour||'',fuelType:v.fuelType||'',engineCapacity:v.engineCapacity?v.engineCapacity+'cc':'',reg:rg||'',source:'plate-lookup'};
if(rv&&rv.makeId)e.makeId=rv.makeId;if(rv&&rv.modelId)e.modelId=rv.modelId;if(rv&&rv.engineId)e.engineId=rv.engineId;if(rv&&rv.engineName)e.engineName=rv.engineName;
var dup=false;for(var i=0;i<g.length;i++){if(g[i].makeName===e.makeName&&g[i].modelName===e.modelName&&g[i].year===e.year){dup=true;break;}}
if(!dup){g.unshift(e);if(g.length>3)g=g.slice(0,3);localStorage.setItem(K,JSON.stringify(g));window.dispatchEvent(new CustomEvent('autosync:garage-changed',{detail:g}));}
aH(rg,{make:ymmeMake,model:ymmeModel});
var sv={makeName:ymmeMake,modelName:ymmeModel,year:String(v.yearOfManufacture||''),colour:v.colour||'',fuelType:v.fuelType||'',engineCapacity:v.engineCapacity?v.engineCapacity+'cc':'',reg:rg||'',source:'plate-lookup'};
if(rv&&rv.makeId){sv.makeId=rv.makeId;sv.modelId=rv.modelId||'';sv.engineId=rv.engineId||'';sv.engineName=rv.engineName||'';}
localStorage.setItem('autosync_vehicle',JSON.stringify(sv));
window.dispatchEvent(new CustomEvent('autosync:vehicle-changed',{detail:sv}));
/* Direct YMME widget population */
if(rv&&rv.makeId&&rv.modelId){directPopulateYMME(P,rv,String(v.yearOfManufacture||''));}
}catch(x){console.error('[plate-lookup] sG error:',x);}}
function directPopulateYMME(proxyUrl,rv,year){
try{
var ymmeC=document.querySelector('[data-autosync-ymme]');if(!ymmeC)return;
var makeS=ymmeC.querySelector('[data-autosync-level="make"]');
var modelS=ymmeC.querySelector('[data-autosync-level="model"]');
var yearS=ymmeC.querySelector('[data-autosync-level="year"]');
var engineS=ymmeC.querySelector('[data-autosync-level="engine"]');
var searchBtn=ymmeC.querySelector('[data-autosync-search]');
/* Set make — update the custom dropdown display */
var selectDisplay=ymmeC.querySelector('[data-autosync-select-display]');
if(selectDisplay){selectDisplay.innerHTML='';
var logoUrl=null;
var selOpts=ymmeC.querySelectorAll('[data-autosync-select-options] li');
for(var si2=0;si2<selOpts.length;si2++){var lid=selOpts[si2].getAttribute('data-value');if(String(lid)===String(rv.makeId)){selOpts[si2].setAttribute('aria-selected','true');selOpts[si2].classList.add('autosync-ymme__select-option--selected');var lImg=selOpts[si2].querySelector('img');if(lImg)logoUrl=lImg.src;}else{selOpts[si2].removeAttribute('aria-selected');selOpts[si2].classList.remove('autosync-ymme__select-option--selected');}}
if(logoUrl){var lEl=document.createElement('img');lEl.src=logoUrl;lEl.alt=rv.makeName||'';lEl.width=20;lEl.height=20;lEl.style.marginRight='6px';selectDisplay.appendChild(lEl);}
selectDisplay.appendChild(document.createTextNode(rv.makeName||''));
var trigger=ymmeC.querySelector('[data-autosync-select-trigger]');if(trigger)trigger.disabled=false;
}
if(makeS){
var mOpts=makeS.querySelectorAll('option');var mFound=false;
for(var i=0;i<mOpts.length;i++){if(String(mOpts[i].value)===String(rv.makeId)){makeS.value=String(rv.makeId);mFound=true;break;}}
if(!mFound){var nOpt=document.createElement('option');nOpt.value=rv.makeId;nOpt.textContent=rv.makeName||'';makeS.appendChild(nOpt);makeS.value=String(rv.makeId);}
}
/* Fetch and set models */
if(!modelS)return;
fetch(proxyUrl+'?path=models&make_id='+encodeURIComponent(rv.makeId))
.then(function(r){return r.json();}).then(function(d){
var models=d.models||[];
while(modelS.firstChild)modelS.removeChild(modelS.firstChild);
var defOpt=document.createElement('option');defOpt.value='';defOpt.textContent='Select Model';modelS.appendChild(defOpt);
models.forEach(function(m){var o=document.createElement('option');o.value=m.id;var lb=m.name;if(m.generation&&m.generation.indexOf(' | ')===-1&&!m.generation.startsWith(m.name))lb+=' ('+m.generation+')';if(m.year_from)lb+=' '+m.year_from+'-'+(m.year_to||'present');o.textContent=lb;o.dataset.name=m.name;modelS.appendChild(o);});
modelS.disabled=false;modelS.value=String(rv.modelId);
/* Fetch and set years */
if(!yearS||!year)return fetch(proxyUrl+'?path=years&model_id='+encodeURIComponent(rv.modelId));
return fetch(proxyUrl+'?path=years&model_id='+encodeURIComponent(rv.modelId));
}).then(function(r){if(!r)return null;return r.json();}).then(function(d){
if(!d||!yearS)return null;
var years=d.years||[];
while(yearS.firstChild)yearS.removeChild(yearS.firstChild);
var defY=document.createElement('option');defY.value='';defY.textContent='Select Year';yearS.appendChild(defY);
years.forEach(function(y){var o=document.createElement('option');o.value=y;o.textContent=String(y);yearS.appendChild(o);});
yearS.disabled=false;
if(year)yearS.value=String(year);
if(searchBtn)searchBtn.disabled=false;
/* Fetch and set engines */
if(!engineS)return null;
var ep=proxyUrl+'?path=engines&model_id='+encodeURIComponent(rv.modelId);
if(year)ep+='&year='+encodeURIComponent(year);
return fetch(ep);
}).then(function(r){if(!r)return null;return r.json();}).then(function(d){
if(!d||!engineS)return;
var engines=d.engines||[];
while(engineS.firstChild)engineS.removeChild(engineS.firstChild);
var defE=document.createElement('option');defE.value='';defE.textContent='Select Engine (optional)';engineS.appendChild(defE);
engines.forEach(function(e2){var o=document.createElement('option');o.value=e2.id;var lb=(e2.name||'').replace(/\s*\[[0-9a-f]{8}\]$/,'');if(e2.displacement_cc)lb+=' '+e2.displacement_cc+'cc';if(e2.fuel_type)lb+=' '+e2.fuel_type;o.textContent=lb;engineS.appendChild(o);});
engineS.disabled=false;
if(rv.engineId)engineS.value=String(rv.engineId);
}).catch(function(err){console.warn('[plate-lookup] directPopulateYMME error:',err);});
}catch(ex){console.warn('[plate-lookup] directPopulateYMME outer error:',ex);}
}
function fR(r){r=r.replace(/\s/g,'').toUpperCase();return r.length===7?r.substring(0,4)+' '+r.substring(4):r;}
function fD(d){if(!d)return'\u2014';try{var x=new Date(d);return isNaN(x.getTime())?d:x.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});}catch(e){return d;}}
sHist();
});})();
