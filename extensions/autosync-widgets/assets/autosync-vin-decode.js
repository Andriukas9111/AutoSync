(function() {
var roots = document.querySelectorAll("[data-avd-root]"); roots.forEach(function(root) {
if (!root) return;

var proxyUrl = root.dataset.proxyUrl;
var logoUrl = root.dataset.logoUrl;
var showProducts = root.dataset.showProducts !== 'false';
var showRaw = root.dataset.showRaw === 'true';
var loadingEl = root.querySelector('[data-avd-loading]');
var errorEl = root.querySelector('[data-avd-error]');
var resultsEl = root.querySelector('[data-avd-results]');
var input = root.querySelector('[data-avd-input]');
var counter = root.querySelector('[data-avd-counter]');
var submitBtn = root.querySelector('[data-avd-submit]');
var retryBtn = root.querySelector('[data-avd-retry]');
var btnLabel = submitBtn ? submitBtn.querySelector('span') : null;
var lastVin = '';

if (!input || !submitBtn) return;

input.addEventListener('input', function() {
this.value = this.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
var len = this.value.length;
if (counter) {
counter.textContent = len + '/17';
counter.className = 'avd-vin-counter' + (len === 17 ? ' avd-vin-counter--valid' : '');
}
submitBtn.disabled = len !== 17;
});

input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !submitBtn.disabled) submitBtn.click(); });
if (retryBtn) retryBtn.addEventListener('click', function() { if (lastVin) doDecode(lastVin); });

submitBtn.addEventListener('click', function() {
var vin = input.value.trim();
if (vin.length !== 17) return;
lastVin = vin;
doDecode(vin);
});

function doDecode(vin) {
submitBtn.disabled = true;
if (btnLabel) btnLabel.textContent = 'Decoding...';
loadingEl.style.display = 'flex';
errorEl.style.display = 'none';
resultsEl.style.display = 'none';

fetch(proxyUrl + '?path=vin-decode', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ vin: vin }),
})
.then(function(r) { return r.json(); })
.then(function(data) {
loadingEl.style.display = 'none';
submitBtn.disabled = false;
if (btnLabel) btnLabel.textContent = 'Decode VIN';
if (data.error) { showError(data.error); return; }
if (data.vehicle) renderResults(data.vehicle, data.compatibleProducts || [], vin);
})
.catch(function() {
loadingEl.style.display = 'none';
submitBtn.disabled = false;
if (btnLabel) btnLabel.textContent = 'Decode VIN';
showError('Failed to decode VIN. Please check and try again.');
});
}

function showError(msg) {
var msgEl = errorEl.querySelector('[data-avd-error-msg]');
if (msgEl) msgEl.textContent = msg;
errorEl.style.display = 'block';
resultsEl.style.display = 'none';
}

function el(tag, className, text) {
var e = document.createElement(tag);
if (className) e.className = className;
if (text !== undefined && text !== null) e.textContent = String(text);
return e;
}

function svgIcon(markup) {
var t = document.createElement('template');
t.innerHTML = markup.trim();
return t.content.firstChild;
}

var ICONS = {
code: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
specs: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
products: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'
};

function renderResults(vehicle, products, vin) {
while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);

var card = el('div', 'avd-vehicle-card');

/* Header */
var header = el('div', 'avd-vehicle-card__header');
var vinTag = el('div', 'avd-vehicle-card__vin-tag');
vinTag.appendChild(svgIcon(ICONS.code));
vinTag.appendChild(document.createTextNode(vin));
header.appendChild(vinTag);

var title = (vehicle.make || '') + ' ' + (vehicle.model || '');
header.appendChild(el('h2', 'avd-vehicle-card__title', title.trim() || 'Unknown Vehicle'));

var subtitleParts = [];
if (vehicle.modelYear) subtitleParts.push(vehicle.modelYear);
if (vehicle.trim) subtitleParts.push(vehicle.trim);
if (vehicle.plantCountry) subtitleParts.push(vehicle.plantCountry);
if (subtitleParts.length) header.appendChild(el('p', 'avd-vehicle-card__subtitle', subtitleParts.join(' \u2022 ')));

var badges = el('div', 'avd-vehicle-card__badges');
if (vehicle.fuelType) badges.appendChild(el('span', 'avd-badge avd-badge--accent', vehicle.fuelType));
if (vehicle.bodyClass) badges.appendChild(el('span', 'avd-badge avd-badge--primary', vehicle.bodyClass));
if (vehicle.driveType) badges.appendChild(el('span', 'avd-badge avd-badge--muted', vehicle.driveType));
if (vehicle.transmissionStyle) badges.appendChild(el('span', 'avd-badge avd-badge--muted', vehicle.transmissionStyle));
if (badges.childNodes.length) header.appendChild(badges);

card.appendChild(header);

/* Spec Grid */
var specSection = el('div', 'avd-spec-section');
var specTitle = el('div', 'avd-spec-section__title');
specTitle.appendChild(svgIcon(ICONS.specs));
specTitle.appendChild(document.createTextNode('Vehicle Specifications'));
specSection.appendChild(specTitle);

var grid = el('div', 'avd-spec-grid');
var specs = [
['Model Year', vehicle.modelYear],
['Body Style', vehicle.bodyClass],
['Drive Type', vehicle.driveType],
['Fuel Type', vehicle.fuelType],
['Cylinders', vehicle.engineCylinders],
['Displacement', vehicle.engineDisplacement ? vehicle.engineDisplacement + ' L' : null],
['Transmission', vehicle.transmissionStyle],
['Manufacturer', vehicle.manufacturer],
['Country', vehicle.plantCountry],
['Trim', vehicle.trim]
];

var addedCount = 0;
for (var i = 0; i < specs.length; i++) {
if (specs[i][1]) {
var item = el('div', 'avd-spec-item');
item.appendChild(el('div', 'avd-spec-item__label', specs[i][0]));
item.appendChild(el('div', 'avd-spec-item__value', String(specs[i][1])));
grid.appendChild(item);
addedCount++;
}
}

if (addedCount % 2 !== 0) {
var spacer = el('div', 'avd-spec-item');
spacer.style.background = 'transparent';
spacer.style.borderRight = 'none';
grid.appendChild(spacer);
}

specSection.appendChild(grid);
card.appendChild(specSection);

/* Find Parts Button */
if (vehicle.make) {
var findBtn = el('button', 'avd-find-parts', 'Find Parts for This Vehicle \u2192');
findBtn.type = 'button';
findBtn.addEventListener('click', function() {
var mk = vehicle.make;
var md = vehicle.model || '';
fetch(proxyUrl + '?path=collection-lookup', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ make: mk, model: md }),
})
.then(function(r) { return r.json(); })
.then(function(res) {
if (res.data && res.data.found && res.data.url) {
window.location.href = res.data.url;
} else {
var slug = mk.toLowerCase().replace(/\s+/g, '-') + '-' + md.toLowerCase().replace(/\s+/g, '-') + '-parts';
window.location.href = '/collections/' + slug;
}
})
.catch(function() {
var slug = mk.toLowerCase().replace(/\s+/g, '-') + '-' + md.toLowerCase().replace(/\s+/g, '-') + '-parts';
window.location.href = '/collections/' + slug;
});
});
card.appendChild(findBtn);
}

/* Compatible Products */
if (showProducts && products.length > 0) {
card.appendChild(el('div', 'avd-divider'));

var prodsSection = el('div', 'avd-products-section');
var prodsTitle = el('div', 'avd-products-section__title');
prodsTitle.appendChild(svgIcon(ICONS.products));
prodsTitle.appendChild(document.createTextNode('Compatible Products (' + products.length + ')'));
prodsSection.appendChild(prodsTitle);

var prodsGrid = el('div', 'avd-products-grid');
var maxProds = Math.min(products.length, 6);
for (var j = 0; j < maxProds; j++) {
var p = products[j];
var a = document.createElement('a');
a.className = 'avd-product-card';
a.href = p.url || '#';
if (p.image) {
var img = document.createElement('img');
img.className = 'avd-product-card__img';
img.src = p.image;
img.alt = p.title || '';
img.loading = 'lazy';
a.appendChild(img);
}
a.appendChild(el('div', 'avd-product-card__name', p.title || 'Product'));
if (p.price) a.appendChild(el('div', 'avd-product-card__price', p.price));
prodsGrid.appendChild(a);
}
prodsSection.appendChild(prodsGrid);
card.appendChild(prodsSection);
}

/* Raw VIN Data (togglable) */
if (showRaw && vehicle) {
card.appendChild(el('div', 'avd-divider'));
var rawSection = el('div', 'avd-raw-section');
var rawToggle = el('button', 'avd-raw-toggle', 'Show Raw VIN Data');
rawToggle.type = 'button';
var rawContent = el('pre', 'avd-raw-content');
rawContent.textContent = JSON.stringify(vehicle, null, 2);
rawContent.style.display = 'none';
rawToggle.addEventListener('click', function() {
var isOpen = rawContent.style.display !== 'none';
rawContent.style.display = isOpen ? 'none' : 'block';
rawToggle.textContent = isOpen ? 'Show Raw VIN Data' : 'Hide Raw VIN Data';
});
rawSection.appendChild(rawToggle);
rawSection.appendChild(rawContent);
card.appendChild(rawSection);
}

/* Footer — only show if merchant hasn't hidden watermark */
if (root.dataset.hideWatermark !== 'true') {
var footer = el('div', 'avd-footer');
footer.style.cssText = 'display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;padding:12px 0 0!important;margin-top:16px!important;font-size:11px!important;color:#9ca3af!important;opacity:0.5!important;';
var logoImg = document.createElement('img');
logoImg.src = logoUrl;
logoImg.alt = 'AutoSync';
logoImg.width = 14;
logoImg.height = 14;
logoImg.className = 'avd-footer__logo';
logoImg.style.cssText = 'width:14px!important;height:14px!important;max-width:14px!important;max-height:14px!important;display:inline-block!important;flex-shrink:0!important;';
footer.appendChild(logoImg);
var pw = el('span', 'avd-footer__text');
pw.textContent = 'Powered by ';
pw.appendChild(el('strong', '', 'AutoSync'));
footer.appendChild(pw);
card.appendChild(footer);
}

resultsEl.appendChild(card);
resultsEl.style.display = 'block';

try {
var stored = { make: vehicle.make, model: vehicle.model, year: vehicle.modelYear, source: 'vin' };
localStorage.setItem('autosync_vehicle', JSON.stringify(stored));
} catch(e) {}
}
});
})();