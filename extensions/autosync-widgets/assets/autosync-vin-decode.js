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
var contentEl = root.querySelector('[data-avd-content]');
var formSideEl = root.querySelector('[data-avd-form-side]');
var input = root.querySelector('[data-avd-input]');
var counter = root.querySelector('[data-avd-counter]');
var submitBtn = root.querySelector('[data-avd-submit]');
var retryBtn = root.querySelector('[data-avd-retry]');
var btnLabel = submitBtn ? submitBtn.querySelector('span') : null;
var lastVin = '';

// Clone original DOM nodes for safe restoration (no innerHTML)
var originalContentClone = contentEl ? contentEl.cloneNode(true) : null;
var originalFormSideClone = formSideEl ? formSideEl.cloneNode(true) : null;

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
arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
};

function restoreInitialState() {
// Restore original content and form via cloned DOM nodes (safe, no innerHTML)
if (contentEl && originalContentClone) {
while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
var freshContent = originalContentClone.cloneNode(true);
while (freshContent.firstChild) contentEl.appendChild(freshContent.firstChild);
}
if (formSideEl && originalFormSideClone) {
while (formSideEl.firstChild) formSideEl.removeChild(formSideEl.firstChild);
var freshForm = originalFormSideClone.cloneNode(true);
while (freshForm.firstChild) formSideEl.appendChild(freshForm.firstChild);
}

// Re-bind input/counter/submit
var newInput = root.querySelector('[data-avd-input]');
var newCounter = root.querySelector('[data-avd-counter]');
var newSubmit = root.querySelector('[data-avd-submit]');
if (newInput && newSubmit) {
input = newInput;
counter = newCounter;
submitBtn = newSubmit;
btnLabel = newSubmit.querySelector('span');

input.value = '';
if (counter) { counter.textContent = '0/17'; counter.className = 'avd-vin-counter'; }
submitBtn.disabled = true;

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
submitBtn.addEventListener('click', function() {
var vin = input.value.trim();
if (vin.length !== 17) return;
lastVin = vin;
doDecode(vin);
});

input.focus();
}

// Ensure content/form sides are visible
if (contentEl) contentEl.style.display = '';
if (formSideEl) formSideEl.style.display = '';

// Clear results
while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
resultsEl.style.display = 'none';
}

function doFindParts(vehicle) {
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
}

function buildSpecGrid(vehicle) {
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
grid.appendChild(el('div', 'avd-spec-item avd-spec-item--spacer'));
}
specSection.appendChild(grid);
return specSection;
}

function buildProductsSection(products) {
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
return prodsSection;
}

function openModal(vehicle, products, vin) {
// Create backdrop
var backdrop = el('div', 'avd-modal-backdrop');
var modal = el('div', 'avd-modal');

// Header
var header = el('div', 'avd-modal__header');
var headerTitle = document.createElement('h3');
headerTitle.textContent = ((vehicle.make || '') + ' ' + (vehicle.model || '')).trim() || 'Vehicle Details';
header.appendChild(headerTitle);
var closeBtn = el('button', 'avd-modal__close', '\u2715');
closeBtn.type = 'button';
header.appendChild(closeBtn);
modal.appendChild(header);

// Body
var body = el('div', 'avd-modal__body');
var card = el('div', 'avd-vehicle-card');

// Card header with VIN tag and badges
var cardHeader = el('div', 'avd-vehicle-card__header');
var vinTag = el('div', 'avd-vehicle-card__vin-tag');
vinTag.appendChild(svgIcon(ICONS.code));
vinTag.appendChild(document.createTextNode(vin));
cardHeader.appendChild(vinTag);

var title = ((vehicle.make || '') + ' ' + (vehicle.model || '')).trim();
cardHeader.appendChild(el('h2', 'avd-vehicle-card__title', title || 'Unknown Vehicle'));

var subtitleParts = [];
if (vehicle.modelYear) subtitleParts.push(vehicle.modelYear);
if (vehicle.trim) subtitleParts.push(vehicle.trim);
if (vehicle.plantCountry) subtitleParts.push(vehicle.plantCountry);
if (subtitleParts.length) cardHeader.appendChild(el('p', 'avd-vehicle-card__subtitle', subtitleParts.join(' \u2022 ')));

var badges = el('div', 'avd-vehicle-card__badges');
if (vehicle.fuelType) badges.appendChild(el('span', 'avd-badge avd-badge--accent', vehicle.fuelType));
if (vehicle.bodyClass) badges.appendChild(el('span', 'avd-badge avd-badge--primary', vehicle.bodyClass));
if (vehicle.driveType) badges.appendChild(el('span', 'avd-badge avd-badge--muted', vehicle.driveType));
if (vehicle.transmissionStyle) badges.appendChild(el('span', 'avd-badge avd-badge--muted', vehicle.transmissionStyle));
if (badges.childNodes.length) cardHeader.appendChild(badges);

card.appendChild(cardHeader);

// Spec grid
card.appendChild(buildSpecGrid(vehicle));

// Find Parts button inside modal
if (vehicle.make) {
var findBtn = el('button', 'avd-find-parts', 'Find Parts for This Vehicle \u2192');
findBtn.type = 'button';
findBtn.style.margin = '14px 24px';
findBtn.style.width = 'calc(100% - 48px)';
findBtn.addEventListener('click', function() { doFindParts(vehicle); });
card.appendChild(findBtn);
}

// Compatible products inside modal
if (showProducts && products.length > 0) {
card.appendChild(el('div', 'avd-divider'));
card.appendChild(buildProductsSection(products));
}

// Raw data inside modal
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

body.appendChild(card);
modal.appendChild(body);
backdrop.appendChild(modal);

// Append to document body (not root) so it overlays everything
document.body.appendChild(backdrop);

// Close handlers
function closeModal() {
if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
}
closeBtn.addEventListener('click', closeModal);
backdrop.addEventListener('click', function(e) {
if (e.target === backdrop) closeModal();
});
document.addEventListener('keydown', function onEsc(e) {
if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onEsc); }
});
}

function renderCompact(vehicle, products, vin) {
while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);

// Replace content side with vehicle summary
if (contentEl) {
while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
var summary = el('div', 'avd-vehicle-summary');
var makeModel = ((vehicle.make || '') + ' ' + (vehicle.model || '')).trim() || 'Unknown Vehicle';
summary.appendChild(el('h2', 'avd-vehicle-summary__make', makeModel));
var specParts = [];
if (vehicle.modelYear) specParts.push(vehicle.modelYear);
if (vehicle.bodyClass) specParts.push(vehicle.bodyClass);
if (vehicle.fuelType) specParts.push(vehicle.fuelType);
if (specParts.length) summary.appendChild(el('p', 'avd-vehicle-summary__specs', specParts.join(' \u00b7 ')));
var vinTag = el('div', 'avd-vehicle-summary__vin-tag');
vinTag.appendChild(svgIcon(ICONS.code));
vinTag.appendChild(document.createTextNode(vin));
summary.appendChild(vinTag);
contentEl.appendChild(summary);
}

// Replace form side with action buttons
if (formSideEl) {
while (formSideEl.firstChild) formSideEl.removeChild(formSideEl.firstChild);
var actions = el('div', 'avd-action-buttons');
var row1 = el('div', 'avd-action-buttons__row');

// Find Parts button
if (vehicle.make) {
var findBtn = el('button', 'avd-action-btn avd-action-btn--primary');
findBtn.type = 'button';
findBtn.appendChild(svgIcon(ICONS.arrow));
findBtn.appendChild(document.createTextNode(' Find Parts'));
findBtn.addEventListener('click', function() { doFindParts(vehicle); });
row1.appendChild(findBtn);
}

// View Details button — opens modal
var detailsBtn = el('button', 'avd-action-btn avd-action-btn--secondary');
detailsBtn.type = 'button';
detailsBtn.appendChild(svgIcon(ICONS.info));
detailsBtn.appendChild(document.createTextNode(' View Details'));
detailsBtn.addEventListener('click', function() {
openModal(vehicle, products, vin);
});
row1.appendChild(detailsBtn);
actions.appendChild(row1);

// New Search button
var row2 = el('div', 'avd-action-buttons__row');
var newSearchBtn = el('button', 'avd-action-btn avd-action-btn--ghost');
newSearchBtn.type = 'button';
newSearchBtn.appendChild(svgIcon(ICONS.refresh));
newSearchBtn.appendChild(document.createTextNode(' New Search'));
newSearchBtn.addEventListener('click', function() {
restoreInitialState();
});
row2.appendChild(newSearchBtn);
actions.appendChild(row2);

formSideEl.appendChild(actions);
}

resultsEl.style.display = 'block';

// Store vehicle for badge/compat widgets
storeVehicle(vehicle);
}

function storeVehicle(vehicle) {
try {
var stored = {
makeName: vehicle.make || '',
modelName: vehicle.model || '',
year: String(vehicle.modelYear || ''),
fuelType: vehicle.fuelType || '',
bodyClass: vehicle.bodyClass || '',
source: 'vin'
};
localStorage.setItem('autosync_vehicle', JSON.stringify(stored));
window.dispatchEvent(new CustomEvent('autosync:vehicle-changed', { detail: stored }));
} catch(e) {}

// Auto-populate YMME widget if present on the page
if (window.__autosyncPopulateYMME && vehicle.make && vehicle.model) {
try {
window.__autosyncPopulateYMME(proxyUrl, vehicle.make, vehicle.model, vehicle.modelYear || '');
} catch(e) { /* non-critical */ }
}
}

function renderResults(vehicle, products, vin) {
// Check result style — compact bar vs full card
var resultStyle = root.dataset.resultStyle || 'compact';
if (resultStyle === 'compact') { renderCompact(vehicle, products, vin); return; }

// Expanded / full card style — renders inside results container
while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);

// Hide content and form sides for expanded view
if (contentEl) contentEl.style.display = 'none';
if (formSideEl) formSideEl.style.display = 'none';

var card = el('div', 'avd-vehicle-card');
card.style.border = '1px solid var(--avd-border)';
card.style.borderRadius = 'var(--avd-radius)';
card.style.maxWidth = '560px';
card.style.margin = '0 auto';

/* Header */
var header = el('div', 'avd-vehicle-card__header');
var vinTagEl = el('div', 'avd-vehicle-card__vin-tag');
vinTagEl.appendChild(svgIcon(ICONS.code));
vinTagEl.appendChild(document.createTextNode(vin));
header.appendChild(vinTagEl);

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
card.appendChild(buildSpecGrid(vehicle));

/* Find Parts Button */
if (vehicle.make) {
var findBtn = el('button', 'avd-find-parts', 'Find Parts for This Vehicle \u2192');
findBtn.type = 'button';
findBtn.addEventListener('click', function() { doFindParts(vehicle); });
card.appendChild(findBtn);
}

/* Compatible Products */
if (showProducts && products.length > 0) {
card.appendChild(el('div', 'avd-divider'));
card.appendChild(buildProductsSection(products));
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

/* New Search link for expanded view */
var newSearchWrap = el('div', '');
newSearchWrap.style.cssText = 'text-align: center; padding: 12px 24px 16px;';
var newSearchLink = el('button', 'avd-action-btn avd-action-btn--ghost');
newSearchLink.type = 'button';
newSearchLink.appendChild(svgIcon(ICONS.refresh));
newSearchLink.appendChild(document.createTextNode(' New Search'));
newSearchLink.addEventListener('click', function() {
if (contentEl) contentEl.style.display = '';
if (formSideEl) formSideEl.style.display = '';
restoreInitialState();
});
newSearchWrap.appendChild(newSearchLink);
card.appendChild(newSearchWrap);

/* Footer — only show if merchant hasn't hidden watermark */
if (root.dataset.hideWatermark !== 'true') {
var footer = el('div', 'avd-footer');
var logoImg = document.createElement('img');
logoImg.src = logoUrl;
logoImg.alt = 'AutoSync';
logoImg.width = 14;
logoImg.height = 14;
logoImg.className = 'avd-footer__logo';
footer.appendChild(logoImg);
var pw = el('span', 'avd-footer__text');
pw.textContent = 'Powered by ';
pw.appendChild(el('strong', '', 'AutoSync'));
footer.appendChild(pw);
card.appendChild(footer);
}

resultsEl.appendChild(card);
resultsEl.style.display = 'block';

// Store vehicle for badge/compat widgets
storeVehicle(vehicle);
}
});
})();
