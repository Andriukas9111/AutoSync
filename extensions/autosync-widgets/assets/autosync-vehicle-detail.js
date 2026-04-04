(function() {
var roots = document.querySelectorAll("[data-avsd-root]"); roots.forEach(function(root) {
if (!root) return;
var proxyUrl = root.dataset.proxyUrl;
var loadingEl = root.querySelector('[data-avsd-loading]');
var errorEl = root.querySelector('[data-avsd-error]');
var contentEl = root.querySelector('[data-avsd-content]');
var retryBtn = root.querySelector('[data-avsd-retry]');
var pathParts = window.location.pathname.split('/');
var handle = pathParts[pathParts.length - 1] || '';
if (!handle || !proxyUrl) {
showError();
return;
}
if (retryBtn) {
retryBtn.addEventListener('click', function() {
showLoading();
fetchData();
});
}
fetchData();
function fetchData() {
var url = new URL(proxyUrl);
url.searchParams.set('path', 'vehicle-specs');
url.searchParams.set('handle', handle);
fetch(url.toString())
.then(function(resp) {
if (!resp.ok) throw new Error('HTTP ' + resp.status);
return resp.json();
})
.then(function(data) {
if (!data.vehicle) throw new Error('No vehicle data');
renderVehicle(data.vehicle, data.products || []);
})
.catch(function(err) {
console.error('[AutoSync] Vehicle spec detail error:', err);
showError();
});
}
function showLoading() {
loadingEl.style.display = 'flex';
errorEl.style.display = 'none';
contentEl.style.display = 'none';
}
function showError() {
loadingEl.style.display = 'none';
errorEl.style.display = 'block';
contentEl.style.display = 'none';
}
function el(tag, className, textContent) {
var e = document.createElement(tag);
if (className) e.className = className;
if (textContent) e.textContent = textContent;
return e;
}
function svgEl(svgMarkup) {
var t = document.createElement('template');
t.innerHTML = svgMarkup.trim();
return t.content.firstChild;
}
function createBadge(iconSvg, text, extraClass) {
var span = el('span', 'avsd-badge' + (extraClass ? ' ' + extraClass : ''));
if (iconSvg) span.appendChild(svgEl(iconSvg));
span.appendChild(document.createTextNode(text));
return span;
}
function createStatCard(iconSvg, value, label) {
var card = el('div', 'avsd-stat');
var iconDiv = el('div', 'avsd-stat__icon');
iconDiv.appendChild(svgEl(iconSvg));
card.appendChild(iconDiv);
card.appendChild(el('p', 'avsd-stat__value', value));
card.appendChild(el('p', 'avsd-stat__label', label));
return card;
}
function createSpecRow(key, value) {
var row = el('div', 'avsd-spec-row');
row.appendChild(el('div', 'avsd-spec-key', key));
row.appendChild(el('div', 'avsd-spec-val', value));
return row;
}
var icons = {
calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
code: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
fuel: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v17"/><path d="M13 10h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 6"/><line x1="3" y1="22" x2="13" y2="22"/></svg>',
car: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.3 1 12.1 1 13v3c0 .6.4 1 1 1h1"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
gear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
transmission: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
torque: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
engine: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
speed: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 0-6.88 17.23"/><path d="M12 2a10 10 0 0 1 6.88 17.23"/><line x1="12" y1="12" x2="12" y2="8"/></svg>',
timer: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
fuelLg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v17"/><path d="M13 10h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 6"/><line x1="3" y1="22" x2="13" y2="22"/></svg>',
carLarge: '<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.3 1 12.1 1 13v3c0 .6.4 1 1 1h1"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
imgPlaceholder: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
};
function renderVehicle(v, products) {
loadingEl.style.display = 'none';
errorEl.style.display = 'none';
contentEl.style.display = 'block';
while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
var heroStyle = root.dataset.heroStyle || 'dark';
var heroClass = 'avsd-hero';
if (heroStyle === 'light') heroClass += ' avsd-hero--light';
else if (heroStyle === 'minimal') heroClass += ' avsd-hero--minimal';
var hero = el('div', heroClass);
var heroInner = el('div', 'avsd-hero__inner');
if (root.dataset.showImage !== 'false' && v.heroImageUrl) {
var heroImageWrap = el('div', 'avsd-hero__image-wrap');
var heroImg = document.createElement('img');
heroImg.src = v.heroImageUrl;
heroImg.alt = (v.make || '') + ' ' + (v.model || '');
heroImg.loading = 'eager';
heroImageWrap.appendChild(heroImg);
heroInner.appendChild(heroImageWrap);
}
var heroInfo = el('div', 'avsd-hero__info');
var bc = el('div', 'avsd-hero__breadcrumb');
if (v.makeLogoUrl) {
var logoImg = document.createElement('img');
logoImg.className = 'avsd-hero__brand-logo';
logoImg.src = v.makeLogoUrl;
logoImg.alt = v.make || '';
logoImg.loading = 'eager';
bc.appendChild(logoImg);
}
var brandSpan = el('span', 'avsd-hero__brand-text', v.make || '');
bc.appendChild(brandSpan);
heroInfo.appendChild(bc);
heroInfo.appendChild(el('h1', 'avsd-hero__title', (v.model || '') + (v.generation ? ' ' + v.generation : '')));
if (v.variant) {
heroInfo.appendChild(el('p', 'avsd-hero__variant', v.variant));
}
var badgesDiv = el('div', 'avsd-hero__badges');
if (v.yearRange) badgesDiv.appendChild(createBadge(icons.calendar, v.yearRange));
if (v.engineCode) badgesDiv.appendChild(createBadge(icons.code, v.engineCode, 'avsd-badge--primary'));
if (v.fuelType) badgesDiv.appendChild(createBadge(icons.fuel, v.fuelType, 'avsd-badge--accent'));
if (v.bodyType) badgesDiv.appendChild(createBadge(icons.car, v.bodyType));
if (v.driveType) badgesDiv.appendChild(createBadge(icons.gear, v.driveType));
if (v.transmission) badgesDiv.appendChild(createBadge(icons.transmission, v.transmission));
if (badgesDiv.childNodes.length > 0) {
heroInfo.appendChild(badgesDiv);
}
if (root.dataset.showOverview !== 'false' && v.overview) {
heroInfo.appendChild(el('p', 'avsd-hero__overview', v.overview));
}
heroInner.appendChild(heroInfo);
hero.appendChild(heroInner);
contentEl.appendChild(hero);
var statDefs = [];
if (v.powerHp) statDefs.push({ icon: icons.bolt, val: v.powerHp + ' HP', lbl: 'Power' });
if (v.torqueNm) statDefs.push({ icon: icons.torque, val: v.torqueNm + ' Nm', lbl: 'Torque' });
if (v.displacement) statDefs.push({ icon: icons.engine, val: v.displacement, lbl: 'Displacement' });
if (v.topSpeed) statDefs.push({ icon: icons.speed, val: v.topSpeed, lbl: 'Top Speed' });
if (v.acceleration) statDefs.push({ icon: icons.timer, val: v.acceleration, lbl: '0-100 km/h' });
if (v.fuelType) statDefs.push({ icon: icons.fuelLg, val: v.fuelType, lbl: 'Fuel Type' });
if (root.dataset.showStats !== 'false' && statDefs.length > 0) {
var statsWrap = el('div', 'avsd-stats-wrap');
var statsGrid = el('div', 'avsd-stats');
for (var si = 0; si < statDefs.length; si++) {
statsGrid.appendChild(createStatCard(statDefs[si].icon, statDefs[si].val, statDefs[si].lbl));
}
statsWrap.appendChild(statsGrid);
contentEl.appendChild(statsWrap);
}
var specs = v.specs || {};
var sectionNames = {
engine: 'Engine', performance: 'Performance', transmission: 'Drivetrain',
dimensions: 'Dimensions', fuel: 'Fuel & Emissions', capacity: 'Weight & Capacity'
};
var sectionOrder = ['engine', 'performance', 'transmission', 'dimensions', 'fuel', 'capacity'];
var activeSections = [];
for (var soi = 0; soi < sectionOrder.length; soi++) {
var sk = sectionOrder[soi];
if (specs[sk] && Object.keys(specs[sk]).length > 0) {
activeSections.push(sk);
}
}
if (activeSections.length > 0) {
var specsWrap = el('div', 'avsd-specs-wrap');
var tabsDiv = el('div', 'avsd-tabs');
tabsDiv.setAttribute('role', 'tablist');
for (var ti = 0; ti < activeSections.length; ti++) {
var tabBtn = el('button', 'avsd-tab' + (ti === 0 ? ' avsd-tab--active' : ''), sectionNames[activeSections[ti]]);
tabBtn.setAttribute('data-avsd-tab', activeSections[ti]);
tabBtn.setAttribute('role', 'tab');
tabBtn.setAttribute('aria-selected', ti === 0 ? 'true' : 'false');
tabsDiv.appendChild(tabBtn);
}
specsWrap.appendChild(tabsDiv);
var panelsDiv = el('div', 'avsd-tab-panels');
for (var pi = 0; pi < activeSections.length; pi++) {
var panelKey = activeSections[pi];
var panel = el('div', 'avsd-tab-panel' + (pi === 0 ? ' avsd-tab-panel--active' : ''));
panel.setAttribute('data-avsd-panel', panelKey);
panel.setAttribute('role', 'tabpanel');
var entries = specs[panelKey];
var entryKeys = Object.keys(entries);
if (entryKeys.length > 0) {
var grid = el('div', 'avsd-spec-grid');
for (var ei = 0; ei < entryKeys.length; ei++) {
grid.appendChild(createSpecRow(entryKeys[ei], entries[entryKeys[ei]]));
}
panel.appendChild(grid);
} else {
panel.appendChild(el('div', 'avsd-spec-empty', 'No data available for this section.'));
}
panelsDiv.appendChild(panel);
}
specsWrap.appendChild(panelsDiv);
contentEl.appendChild(specsWrap);
var allTabs = tabsDiv.querySelectorAll('[data-avsd-tab]');
var allPanels = panelsDiv.querySelectorAll('[data-avsd-panel]');
for (var tbi = 0; tbi < allTabs.length; tbi++) {
allTabs[tbi].addEventListener('click', function() {
var target = this.getAttribute('data-avsd-tab');
for (var x = 0; x < allTabs.length; x++) {
allTabs[x].classList.remove('avsd-tab--active');
allTabs[x].setAttribute('aria-selected', 'false');
}
for (var y = 0; y < allPanels.length; y++) {
allPanels[y].classList.remove('avsd-tab-panel--active');
}
this.classList.add('avsd-tab--active');
this.setAttribute('aria-selected', 'true');
var targetPanel = panelsDiv.querySelector('[data-avsd-panel="' + target + '"]');
if (targetPanel) targetPanel.classList.add('avsd-tab-panel--active');
});
}
}
if (root.dataset.showProducts !== 'false' && products.length > 0) {
var prodWrap = el('div', 'avsd-products-wrap');
var prodHeader = el('div', 'avsd-products-header');
prodHeader.appendChild(el('h2', 'avsd-products-heading', 'Compatible Parts & Accessories'));
prodHeader.appendChild(el('p', 'avsd-products-sub', products.length + ' product' + (products.length !== 1 ? 's' : '') + ' confirmed compatible with this vehicle'));
prodWrap.appendChild(prodHeader);
var prodGrid = el('div', 'avsd-products-grid');
for (var pi2 = 0; pi2 < products.length; pi2++) {
var prod = products[pi2];
var card = document.createElement('a');
card.href = '/products/' + prod.handle;
card.className = 'avsd-product-card';
var imgWrap = el('div', 'avsd-product-card__img-wrap');
if (prod.imageUrl) {
var prodImg = document.createElement('img');
prodImg.className = 'avsd-product-card__img';
prodImg.src = prod.imageUrl;
prodImg.alt = prod.title;
prodImg.loading = 'lazy';
imgWrap.appendChild(prodImg);
} else {
var prodPh = el('div', 'avsd-product-card__img');
prodPh.style.display = 'flex';
prodPh.style.alignItems = 'center';
prodPh.style.justifyContent = 'center';
prodPh.appendChild(svgEl(icons.imgPlaceholder));
imgWrap.appendChild(prodPh);
}
card.appendChild(imgWrap);
var body = el('div', 'avsd-product-card__body');
body.appendChild(el('p', 'avsd-product-card__title', prod.title));
if (prod.price) body.appendChild(el('p', 'avsd-product-card__price', prod.price));
card.appendChild(body);
prodGrid.appendChild(card);
}
prodWrap.appendChild(prodGrid);
contentEl.appendChild(prodWrap);
}
/* Footer — only show if merchant hasn't hidden watermark */
if (root.dataset.hideWatermark !== 'true') {
var footerWrap = el('div', 'avsd-footer-wrap');
footerWrap.style.cssText = 'text-align:center!important;';
var footer = el('div', 'avsd-footer');
footer.style.cssText = 'display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;padding:12px 0 0!important;margin-top:16px!important;font-size:11px!important;color:#9ca3af!important;opacity:0.5!important;';
var logoImg = document.createElement('img');
logoImg.src = root.dataset.logoUrl || '';
logoImg.alt = 'AutoSync';
logoImg.width = 14;
logoImg.height = 14;
logoImg.style.cssText = 'width:14px!important;height:14px!important;max-width:14px!important;max-height:14px!important;display:inline-block!important;flex-shrink:0!important;';
footer.appendChild(logoImg);
var poweredText = el('span', 'avsd-footer__text');
poweredText.textContent = 'Powered by ';
var brandSpan = el('strong', '', 'AutoSync');
poweredText.appendChild(brandSpan);
footer.appendChild(poweredText);
footerWrap.appendChild(footer);
contentEl.appendChild(footerWrap);
}
}
});
})();