/**
 * AutoSync Widgets — Shared JS for all theme app extension blocks
 * Handles: YMME search, fitment badges, compatibility tables,
 *          floating vehicle bar, plate lookup, wheel finder
 */
(function () {
  'use strict';

  // Prevent double-init
  if (window.__autosyncWidgetsLoaded) return;
  window.__autosyncWidgetsLoaded = true;

  var STORAGE_KEY = 'autosync_vehicle';

  // --------------- Helpers ---------------

  function getStoredVehicle() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function storeVehicle(vehicle) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicle));
      window.dispatchEvent(new CustomEvent('autosync:vehicle-changed', { detail: vehicle }));
    } catch (e) { /* quota exceeded */ }
  }

  function clearVehicle() {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('autosync:vehicle-changed', { detail: null }));
  }

  function escapeText(str) {
    if (!str) return '';
    return String(str);
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function addOption(select, value, text) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    return opt;
  }

  async function proxyFetch(proxyUrl, path, params) {
    var url = new URL(proxyUrl);
    url.searchParams.set('path', path);
    if (params) {
      Object.entries(params).forEach(function (entry) {
        if (entry[1] != null && entry[1] !== '') url.searchParams.set(entry[0], entry[1]);
      });
    }
    var resp = await fetch(url.toString());
    if (!resp.ok) throw new Error('Proxy request failed: ' + resp.status);
    return resp.json();
  }

  function setSelectLoading(select) {
    select.disabled = true;
    clearChildren(select);
    select.appendChild(addOption(select, '', 'Loading...'));
  }

  function resetSelect(select, placeholder) {
    clearChildren(select);
    select.appendChild(addOption(select, '', placeholder));
    select.disabled = true;
  }

  // --------------- YMME Search ---------------

  function initYmmeSearch(container) {
    var proxyUrl = container.dataset.proxyUrl;
    if (!proxyUrl) return;

    var makeSelect = container.querySelector('[data-autosync-level="make"]');
    var modelSelect = container.querySelector('[data-autosync-level="model"]');
    var yearSelect = container.querySelector('[data-autosync-level="year"]');
    var engineSelect = container.querySelector('[data-autosync-level="engine"]');
    var searchBtn = container.querySelector('[data-autosync-search]');

    if (!makeSelect) return;

    // State
    var state = { make: null, makeName: '', model: null, modelName: '', year: null, engine: null, engineName: '' };

    // Load makes
    setSelectLoading(makeSelect);
    proxyFetch(proxyUrl, 'makes').then(function (data) {
      clearChildren(makeSelect);
      makeSelect.appendChild(addOption(makeSelect, '', 'Select Make'));
      (data.makes || []).forEach(function (m) {
        var opt = addOption(makeSelect, m.id, escapeText(m.name));
        makeSelect.appendChild(opt);
      });
      makeSelect.disabled = false;
    }).catch(function () {
      clearChildren(makeSelect);
      makeSelect.appendChild(addOption(makeSelect, '', 'Error loading makes'));
    });

    // Cascade: Make -> Models
    makeSelect.addEventListener('change', function () {
      state.make = this.value;
      state.makeName = this.options[this.selectedIndex] ? this.options[this.selectedIndex].textContent : '';
      resetSelect(modelSelect, 'Select Model');
      resetSelect(yearSelect, 'Select Year');
      resetSelect(engineSelect, 'Select Engine (optional)');
      searchBtn.disabled = true;

      if (!state.make) return;

      setSelectLoading(modelSelect);
      proxyFetch(proxyUrl, 'models', { make_id: state.make }).then(function (data) {
        clearChildren(modelSelect);
        modelSelect.appendChild(addOption(modelSelect, '', 'Select Model'));
        (data.models || []).forEach(function (m) {
          var label = escapeText(m.name);
          if (m.generation) label += ' (' + escapeText(m.generation) + ')';
          if (m.year_from) label += ' ' + m.year_from + '-' + (m.year_to || 'present');
          var opt = addOption(modelSelect, m.id, label);
          opt.dataset.name = m.name;
          modelSelect.appendChild(opt);
        });
        modelSelect.disabled = false;
      }).catch(function () {
        clearChildren(modelSelect);
        modelSelect.appendChild(addOption(modelSelect, '', 'Error loading models'));
      });
    });

    // Cascade: Model -> Years
    modelSelect.addEventListener('change', function () {
      state.model = this.value;
      var selected = this.options[this.selectedIndex];
      state.modelName = (selected && selected.dataset.name) ? selected.dataset.name : (selected ? selected.textContent : '');
      resetSelect(yearSelect, 'Select Year');
      resetSelect(engineSelect, 'Select Engine (optional)');
      searchBtn.disabled = true;

      if (!state.model) return;

      setSelectLoading(yearSelect);
      proxyFetch(proxyUrl, 'years', { model_id: state.model }).then(function (data) {
        clearChildren(yearSelect);
        yearSelect.appendChild(addOption(yearSelect, '', 'Select Year'));
        (data.years || []).forEach(function (y) {
          yearSelect.appendChild(addOption(yearSelect, y, String(y)));
        });
        yearSelect.disabled = false;
      }).catch(function () {
        clearChildren(yearSelect);
        yearSelect.appendChild(addOption(yearSelect, '', 'Error loading years'));
      });
    });

    // Cascade: Year -> Engines
    yearSelect.addEventListener('change', function () {
      state.year = this.value;
      resetSelect(engineSelect, 'Select Engine (optional)');
      searchBtn.disabled = !state.year;

      if (!state.year) return;

      setSelectLoading(engineSelect);
      proxyFetch(proxyUrl, 'engines', { model_id: state.model, year: state.year }).then(function (data) {
        clearChildren(engineSelect);
        engineSelect.appendChild(addOption(engineSelect, '', 'Any Engine'));
        (data.engines || []).forEach(function (e) {
          var label = escapeText(e.name);
          if (e.displacement_cc) label += ' ' + e.displacement_cc + 'cc';
          if (e.fuel_type) label += ' ' + escapeText(e.fuel_type);
          var opt = addOption(engineSelect, e.id, label);
          opt.dataset.name = e.name;
          engineSelect.appendChild(opt);
        });
        engineSelect.disabled = false;
      }).catch(function () {
        clearChildren(engineSelect);
        engineSelect.appendChild(addOption(engineSelect, '', 'Error loading engines'));
      });
    });

    engineSelect.addEventListener('change', function () {
      state.engine = this.value;
      var selected = this.options[this.selectedIndex];
      state.engineName = (selected && selected.dataset.name) ? selected.dataset.name : '';
    });

    // Search button
    searchBtn.addEventListener('click', function () {
      if (!state.make || !state.model || !state.year) return;

      storeVehicle({
        makeId: state.make,
        makeName: state.makeName,
        modelId: state.model,
        modelName: state.modelName,
        year: state.year,
        engineId: state.engine || null,
        engineName: state.engineName || null,
      });

      var searchQuery = encodeURIComponent(state.makeName + ' ' + state.modelName);
      window.location.href = '/search?q=' + searchQuery + '&type=product';
    });
  }

  // --------------- Fitment Badge ---------------

  function initFitmentBadge(container) {
    var productTags = (container.dataset.productTags || '').toLowerCase();
    var metaMake = (container.dataset.productMetafieldMake || '').toLowerCase();
    var metaModel = (container.dataset.productMetafieldModel || '').toLowerCase();

    var fitsEl = container.querySelector('[data-autosync-badge-fits]');
    var nofitEl = container.querySelector('[data-autosync-badge-nofit]');
    var novehicleEl = container.querySelector('[data-autosync-badge-novehicle]');
    var vehicleNameEl = container.querySelector('[data-autosync-badge-vehicle-name]');

    function update() {
      var vehicle = getStoredVehicle();

      if (fitsEl) fitsEl.classList.add('autosync-fitment-badge--hidden');
      if (nofitEl) nofitEl.classList.add('autosync-fitment-badge--hidden');
      if (novehicleEl) novehicleEl.classList.add('autosync-fitment-badge--hidden');

      if (!vehicle || !vehicle.makeName) {
        if (novehicleEl) novehicleEl.classList.remove('autosync-fitment-badge--hidden');
        return;
      }

      var makeLower = vehicle.makeName.toLowerCase();
      var modelLower = vehicle.modelName.toLowerCase();

      var fits = false;
      if (productTags) {
        fits = productTags.indexOf(makeLower) !== -1 && productTags.indexOf(modelLower) !== -1;
      }
      if (!fits && metaMake && metaModel) {
        fits = metaMake.indexOf(makeLower) !== -1 && metaModel.indexOf(modelLower) !== -1;
      }

      if (fits) {
        if (fitsEl) fitsEl.classList.remove('autosync-fitment-badge--hidden');
        if (vehicleNameEl) {
          vehicleNameEl.textContent = '(' + vehicle.year + ' ' + vehicle.makeName + ' ' + vehicle.modelName + ')';
        }
      } else {
        if (nofitEl) nofitEl.classList.remove('autosync-fitment-badge--hidden');
      }
    }

    update();
    window.addEventListener('autosync:vehicle-changed', update);
  }

  // --------------- Compatibility Table ---------------

  function initCompatTable(container) {
    var metaVehicles = container.dataset.metafieldVehicles;
    var tbody = container.querySelector('[data-autosync-compat-body]');
    if (!tbody) return;

    clearChildren(tbody);

    if (!metaVehicles) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.setAttribute('colspan', '4');
      emptyCell.textContent = 'No compatibility data available';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    try {
      var vehicles = JSON.parse(metaVehicles);
      if (!Array.isArray(vehicles) || vehicles.length === 0) {
        var noRow = document.createElement('tr');
        var noCell = document.createElement('td');
        noCell.setAttribute('colspan', '4');
        noCell.textContent = 'No vehicles listed';
        noRow.appendChild(noCell);
        tbody.appendChild(noRow);
        return;
      }

      vehicles.forEach(function (v) {
        var tr = document.createElement('tr');

        var tdMake = document.createElement('td');
        tdMake.textContent = escapeText(v.make);
        tr.appendChild(tdMake);

        var tdModel = document.createElement('td');
        tdModel.textContent = escapeText(v.model);
        tr.appendChild(tdModel);

        var tdYears = document.createElement('td');
        tdYears.textContent = (v.year_from || '') + (v.year_to ? '\u2013' + v.year_to : '+');
        tr.appendChild(tdYears);

        var tdEngine = document.createElement('td');
        tdEngine.textContent = v.engine ? escapeText(v.engine) : '\u2014';
        tr.appendChild(tdEngine);

        tbody.appendChild(tr);
      });
    } catch (e) {
      var errRow = document.createElement('tr');
      var errCell = document.createElement('td');
      errCell.setAttribute('colspan', '4');
      errCell.textContent = 'Error parsing compatibility data';
      errRow.appendChild(errCell);
      tbody.appendChild(errRow);
    }
  }

  // --------------- Floating Vehicle Bar ---------------

  function initVehicleBar(container) {
    var vehicleSpan = container.querySelector('[data-autosync-bar-vehicle]');
    var changeBtn = container.querySelector('[data-autosync-bar-change]');
    var clearBtn = container.querySelector('[data-autosync-bar-clear]');

    function update() {
      var vehicle = getStoredVehicle();
      if (vehicle && vehicle.makeName) {
        container.classList.remove('autosync-vehicle-bar--hidden');
        if (vehicleSpan) {
          vehicleSpan.textContent = vehicle.year + ' ' + vehicle.makeName + ' ' + vehicle.modelName;
        }
      } else {
        container.classList.add('autosync-vehicle-bar--hidden');
      }
    }

    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        var ymme = document.querySelector('[data-autosync-ymme]');
        if (ymme) {
          ymme.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearVehicle();
        update();
      });
    }

    update();
    window.addEventListener('autosync:vehicle-changed', update);
  }

  // --------------- Plate Lookup ---------------

  function initPlateLookup(container) {
    var proxyUrl = container.dataset.proxyUrl;
    var input = container.querySelector('[data-autosync-plate-input]');
    var submitBtn = container.querySelector('[data-autosync-plate-submit]');
    var resultDiv = container.querySelector('[data-autosync-plate-result]');
    var errorDiv = container.querySelector('[data-autosync-plate-error]');

    if (!submitBtn || !input) return;

    input.addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    });

    submitBtn.addEventListener('click', function () {
      var reg = input.value.trim().replace(/\s+/g, '');
      if (reg.length < 2) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Looking up...';

      if (resultDiv) resultDiv.classList.add('autosync-plate-lookup--hidden');
      if (errorDiv) errorDiv.classList.add('autosync-plate-lookup--hidden');

      fetch(proxyUrl + '?path=plate-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration: reg }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Look Up';

          if (data.error) {
            if (errorDiv) {
              var msg = errorDiv.querySelector('[data-autosync-plate-error-msg]');
              if (msg) msg.textContent = escapeText(data.error);
              errorDiv.classList.remove('autosync-plate-lookup--hidden');
            }
            return;
          }

          if (resultDiv && data.vehicle) {
            var v = data.vehicle;
            var nameEl = resultDiv.querySelector('[data-autosync-plate-vehicle-name]');
            if (nameEl) nameEl.textContent = escapeText(v.make) + ' ' + escapeText(v.model);

            var fields = {
              colour: v.colour,
              fuel: v.fuelType,
              year: v.yearOfManufacture,
              engine: v.engineCapacity ? v.engineCapacity + 'cc' : '',
              mot: v.motExpiryDate || (data.motHistory && data.motHistory.motTests && data.motHistory.motTests[0] ? data.motHistory.motTests[0].expiryDate : 'N/A'),
            };
            Object.keys(fields).forEach(function (key) {
              var el = resultDiv.querySelector('[data-autosync-plate-' + key + ']');
              if (el) el.textContent = escapeText(fields[key]) || '\u2014';
            });

            // Store the identified vehicle for fitment badge cross-referencing
            storeVehicle({
              makeName: v.make,
              modelName: v.model,
              year: String(v.yearOfManufacture),
              source: 'plate-lookup',
            });

            resultDiv.classList.remove('autosync-plate-lookup--hidden');

            // Show compatible products count if available
            var partsBtn = resultDiv.querySelector('[data-autosync-plate-find-parts]');
            if (partsBtn && data.compatibleCount > 0) {
              partsBtn.textContent = 'Find ' + data.compatibleCount + ' Compatible Part' + (data.compatibleCount !== 1 ? 's' : '');
              partsBtn.onclick = function () {
                window.location.href = '/search?q=' + encodeURIComponent(v.make + ' ' + v.model) + '&type=product';
              };
            }
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Look Up';
          if (errorDiv) {
            var msg = errorDiv.querySelector('[data-autosync-plate-error-msg]');
            if (msg) msg.textContent = 'Failed to look up registration. Please try again.';
            errorDiv.classList.remove('autosync-plate-lookup--hidden');
          }
        });
    });
  }

  // --------------- Wheel Finder ---------------

  function initWheelFinder(container) {
    var proxyUrl = container.dataset.proxyUrl;
    var searchBtn = container.querySelector('[data-autosync-wheel-search]');
    var resultsDiv = container.querySelector('[data-autosync-wheel-results]');

    if (!searchBtn) return;

    searchBtn.addEventListener('click', function () {
      var pcdEl = container.querySelector('[data-autosync-wheel-pcd]');
      var diameterEl = container.querySelector('[data-autosync-wheel-diameter]');
      var offsetEl = container.querySelector('[data-autosync-wheel-offset]');

      var pcd = pcdEl ? pcdEl.value : '';
      var diameter = diameterEl ? diameterEl.value : '';
      var offset = offsetEl ? offsetEl.value : '';

      if (!pcd && !diameter) return;

      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching...';

      proxyFetch(proxyUrl, 'wheel-search', { pcd: pcd, diameter: diameter, offset: offset })
        .then(function (data) {
          searchBtn.disabled = false;
          searchBtn.textContent = 'Search Wheels';

          if (resultsDiv) {
            clearChildren(resultsDiv);

            if (data.error) {
              var errP = document.createElement('p');
              errP.className = 'autosync-wheel-finder__error';
              errP.textContent = escapeText(data.error);
              resultsDiv.appendChild(errP);
            } else if (data.wheels && data.wheels.length > 0) {
              var heading = document.createElement('p');
              heading.className = 'autosync-wheel-finder__count';
              heading.textContent = data.count + ' matching wheel' + (data.count !== 1 ? 's' : '') + ' found';
              resultsDiv.appendChild(heading);

              var grid = document.createElement('div');
              grid.className = 'autosync-wheel-finder__grid';

              data.wheels.forEach(function (item) {
                var card = document.createElement('a');
                card.className = 'autosync-wheel-finder__card';
                card.href = '/products/' + escapeText(item.product.handle);

                if (item.product.image_url) {
                  var img = document.createElement('img');
                  img.src = item.product.image_url;
                  img.alt = escapeText(item.product.title);
                  img.loading = 'lazy';
                  card.appendChild(img);
                }

                var title = document.createElement('span');
                title.className = 'autosync-wheel-finder__title';
                title.textContent = escapeText(item.product.title);
                card.appendChild(title);

                if (item.product.price) {
                  var price = document.createElement('span');
                  price.className = 'autosync-wheel-finder__price';
                  price.textContent = '\u00A3' + Number(item.product.price).toFixed(2);
                  card.appendChild(price);
                }

                grid.appendChild(card);
              });

              resultsDiv.appendChild(grid);
            } else {
              var noResults = document.createElement('p');
              noResults.textContent = 'No wheels found matching your criteria.';
              resultsDiv.appendChild(noResults);
            }

            resultsDiv.classList.remove('autosync-wheel-finder--hidden');
          }
        })
        .catch(function () {
          searchBtn.disabled = false;
          searchBtn.textContent = 'Search Wheels';
        });
    });
  }

  // --------------- VIN Decode ---------------

  function initVinDecode(container) {
    var proxyUrl = container.dataset.proxyUrl;
    var input = container.querySelector('[data-autosync-vin-input]');
    var submitBtn = container.querySelector('[data-autosync-vin-submit]');
    var resultDiv = container.querySelector('[data-autosync-vin-result]');
    var errorDiv = container.querySelector('[data-autosync-vin-error]');

    if (!submitBtn || !input) return;

    // VIN input formatting — uppercase, alphanumeric only, no I/O/Q
    input.addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
    });

    submitBtn.addEventListener('click', function () {
      var vin = input.value.trim();
      if (vin.length !== 17) {
        if (errorDiv) {
          var msg = errorDiv.querySelector('[data-autosync-vin-error-msg]');
          if (msg) msg.textContent = 'VIN must be exactly 17 characters.';
          errorDiv.classList.remove('autosync-vin-decode--hidden');
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Decoding...';

      if (resultDiv) resultDiv.classList.add('autosync-vin-decode--hidden');
      if (errorDiv) errorDiv.classList.add('autosync-vin-decode--hidden');

      fetch(proxyUrl + '?path=vin-decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin: vin }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Decode VIN';

          if (data.error) {
            if (errorDiv) {
              var msg = errorDiv.querySelector('[data-autosync-vin-error-msg]');
              if (msg) msg.textContent = escapeText(data.error);
              errorDiv.classList.remove('autosync-vin-decode--hidden');
            }
            return;
          }

          if (resultDiv && data.vehicle) {
            var v = data.vehicle;
            var nameEl = resultDiv.querySelector('[data-autosync-vin-vehicle-name]');
            if (nameEl) nameEl.textContent = v.year + ' ' + escapeText(v.make) + ' ' + escapeText(v.model);

            var fields = {
              body: v.bodyClass,
              drive: v.driveType,
              engine: v.engineCylinders ? v.engineCylinders + ' cyl' + (v.engineDisplacement ? ', ' + v.engineDisplacement + 'L' : '') : '',
              fuel: v.fuelType,
              transmission: v.transmissionStyle,
              trim: v.trim,
              manufacturer: v.manufacturer,
              country: v.plantCountry,
            };
            Object.keys(fields).forEach(function (key) {
              var el = resultDiv.querySelector('[data-autosync-vin-' + key + ']');
              if (el) el.textContent = escapeText(fields[key]) || '\u2014';
            });

            // Store the decoded vehicle
            storeVehicle({
              makeName: v.make,
              modelName: v.model,
              year: String(v.year),
              source: 'vin-decode',
            });

            resultDiv.classList.remove('autosync-vin-decode--hidden');

            // Show compatible products
            var partsBtn = resultDiv.querySelector('[data-autosync-vin-find-parts]');
            if (partsBtn && data.compatibleCount > 0) {
              partsBtn.textContent = 'Find ' + data.compatibleCount + ' Compatible Part' + (data.compatibleCount !== 1 ? 's' : '');
              partsBtn.classList.remove('autosync-vin-decode--hidden');
              partsBtn.onclick = function () {
                window.location.href = '/search?q=' + encodeURIComponent(v.make + ' ' + v.model) + '&type=product';
              };
            }
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Decode VIN';
          if (errorDiv) {
            var msg = errorDiv.querySelector('[data-autosync-vin-error-msg]');
            if (msg) msg.textContent = 'Failed to decode VIN. Please try again.';
            errorDiv.classList.remove('autosync-vin-decode--hidden');
          }
        });
    });
  }

  // --------------- Init on DOM ready ---------------

  function init() {
    document.querySelectorAll('[data-autosync-ymme]').forEach(initYmmeSearch);
    document.querySelectorAll('[data-autosync-fitment-badge]').forEach(initFitmentBadge);
    document.querySelectorAll('[data-autosync-compat-table]').forEach(initCompatTable);
    document.querySelectorAll('[data-autosync-vehicle-bar]').forEach(initVehicleBar);
    document.querySelectorAll('[data-autosync-plate-lookup]').forEach(initPlateLookup);
    document.querySelectorAll('[data-autosync-wheel-finder]').forEach(initWheelFinder);
    document.querySelectorAll('[data-autosync-vin-decode]').forEach(initVinDecode);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
