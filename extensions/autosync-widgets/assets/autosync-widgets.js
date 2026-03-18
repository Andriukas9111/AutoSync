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
  var GARAGE_KEY = 'autosync_garage';
  var GARAGE_MAX = 3;

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

  /** Create an SVG element with namespace */
  function createSvgIcon(width, height, paths) {
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('fill', 'none');
    paths.forEach(function (p) {
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', p.d);
      path.setAttribute('stroke', p.stroke || 'currentColor');
      path.setAttribute('stroke-width', p.strokeWidth || '1.5');
      path.setAttribute('stroke-linecap', p.linecap || 'round');
      if (p.linejoin) path.setAttribute('stroke-linejoin', p.linejoin);
      svg.appendChild(path);
    });
    return svg;
  }

  // --------------- Garage Helpers ---------------

  function getGarage() {
    try {
      var raw = localStorage.getItem(GARAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveGarage(garage) {
    try {
      localStorage.setItem(GARAGE_KEY, JSON.stringify(garage));
      window.dispatchEvent(new CustomEvent('autosync:garage-changed', { detail: garage }));
    } catch (e) { /* quota */ }
  }

  function addToGarage(vehicle) {
    var garage = getGarage();
    // Deduplicate by make+model+year
    var key = (vehicle.makeName + '|' + vehicle.modelName + '|' + vehicle.year).toLowerCase();
    for (var i = 0; i < garage.length; i++) {
      var existing = (garage[i].makeName + '|' + garage[i].modelName + '|' + garage[i].year).toLowerCase();
      if (existing === key) return garage; // already exists
    }
    garage.unshift(vehicle);
    if (garage.length > GARAGE_MAX) garage = garage.slice(0, GARAGE_MAX);
    saveGarage(garage);
    return garage;
  }

  function removeFromGarage(index) {
    var garage = getGarage();
    garage.splice(index, 1);
    saveGarage(garage);
    return garage;
  }

  function clearGarage() {
    saveGarage([]);
  }

  // --------------- Custom Make Dropdown ---------------

  function createMakeInitials(name) {
    if (!name) return '?';
    var words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }

  function buildCustomMakeDropdown(container, makes, showLogos) {
    var customSelect = container.querySelector('[data-autosync-custom-select="make"]');
    if (!customSelect) return;

    var trigger = customSelect.querySelector('[data-autosync-select-trigger]');
    var dropdown = customSelect.querySelector('[data-autosync-select-dropdown]');
    var searchInput = customSelect.querySelector('[data-autosync-select-search]');
    var optionsList = customSelect.querySelector('[data-autosync-select-options]');

    if (!trigger || !dropdown || !optionsList) return;

    var isOpen = false;
    var allMakes = makes || [];
    var selectedMake = null;

    function setDisplay(text, logoUrl, name) {
      var display = trigger.querySelector('[data-autosync-select-display]');
      if (!display) return;
      clearChildren(display);

      if (logoUrl && showLogos) {
        var img = document.createElement('img');
        img.src = logoUrl;
        img.alt = name || '';
        img.width = 24;
        img.height = 24;
        img.className = 'autosync-ymme__make-logo';
        img.onerror = function () {
          this.style.display = 'none';
          var fallback = this.nextElementSibling;
          if (fallback && fallback.classList.contains('autosync-ymme__make-initials')) {
            fallback.style.display = 'flex';
          }
        };
        display.appendChild(img);

        var initials = document.createElement('span');
        initials.className = 'autosync-ymme__make-initials';
        initials.textContent = createMakeInitials(name);
        initials.style.display = 'none';
        display.appendChild(initials);
      } else if (showLogos && name) {
        var init = document.createElement('span');
        init.className = 'autosync-ymme__make-initials';
        init.textContent = createMakeInitials(name);
        display.appendChild(init);
      }

      var span = document.createElement('span');
      span.textContent = text;
      display.appendChild(span);
    }

    function renderOptions(filter) {
      clearChildren(optionsList);
      var lowerFilter = (filter || '').toLowerCase();
      var count = 0;

      allMakes.forEach(function (m) {
        if (lowerFilter && m.name.toLowerCase().indexOf(lowerFilter) === -1) return;
        count++;

        var li = document.createElement('li');
        li.className = 'autosync-ymme__select-option';
        li.setAttribute('role', 'option');
        li.dataset.value = m.id;
        li.dataset.name = m.name;
        li.dataset.logoUrl = m.logo_url || '';

        if (showLogos) {
          if (m.logo_url) {
            var img = document.createElement('img');
            img.src = m.logo_url;
            img.alt = '';
            img.width = 24;
            img.height = 24;
            img.className = 'autosync-ymme__make-logo';
            img.loading = 'lazy';
            img.onerror = function () {
              this.style.display = 'none';
              var fallback = this.nextElementSibling;
              if (fallback && fallback.classList.contains('autosync-ymme__make-initials')) {
                fallback.style.display = 'flex';
              }
            };
            li.appendChild(img);

            var initials = document.createElement('span');
            initials.className = 'autosync-ymme__make-initials';
            initials.textContent = createMakeInitials(m.name);
            initials.style.display = 'none';
            li.appendChild(initials);
          } else {
            var init = document.createElement('span');
            init.className = 'autosync-ymme__make-initials';
            init.textContent = createMakeInitials(m.name);
            li.appendChild(init);
          }
        }

        var nameSpan = document.createElement('span');
        nameSpan.className = 'autosync-ymme__option-name';
        nameSpan.textContent = m.name;
        li.appendChild(nameSpan);

        if (m.country) {
          var countrySpan = document.createElement('span');
          countrySpan.className = 'autosync-ymme__option-country';
          countrySpan.textContent = m.country;
          li.appendChild(countrySpan);
        }

        if (selectedMake && selectedMake.id === m.id) {
          li.classList.add('autosync-ymme__select-option--selected');
        }

        li.addEventListener('click', function () {
          selectedMake = m;
          setDisplay(m.name, m.logo_url, m.name);
          closeDropdown();

          // Sync hidden select
          var hiddenSelect = container.querySelector('[data-autosync-level="make"]');
          if (hiddenSelect) {
            clearChildren(hiddenSelect);
            hiddenSelect.appendChild(addOption(hiddenSelect, '', 'Select Make'));
            var opt = addOption(hiddenSelect, m.id, m.name);
            hiddenSelect.appendChild(opt);
            hiddenSelect.value = m.id;
            hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        optionsList.appendChild(li);
      });

      if (count === 0) {
        var noResults = document.createElement('li');
        noResults.className = 'autosync-ymme__select-no-results';
        noResults.textContent = 'No makes found';
        optionsList.appendChild(noResults);
      }
    }

    function openDropdown() {
      if (trigger.disabled) return;
      isOpen = true;
      customSelect.classList.add('autosync-ymme__custom-select--open');
      renderOptions('');
      if (searchInput) {
        searchInput.value = '';
        setTimeout(function () { searchInput.focus(); }, 50);
      }
    }

    function closeDropdown() {
      isOpen = false;
      customSelect.classList.remove('autosync-ymme__custom-select--open');
    }

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        renderOptions(this.value);
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDropdown();
      });
    }

    // Close when clicking outside
    document.addEventListener('click', function (e) {
      if (isOpen && !customSelect.contains(e.target)) {
        closeDropdown();
      }
    });

    // Enable the trigger
    trigger.disabled = false;
    setDisplay('Select Make', null, null);

    return {
      reset: function () {
        selectedMake = null;
        setDisplay('Select Make', null, null);
      },
      setLoading: function () {
        trigger.disabled = true;
        var display = trigger.querySelector('[data-autosync-select-display]');
        if (display) {
          clearChildren(display);
          var spinner = document.createElement('span');
          spinner.className = 'autosync-ymme__spinner autosync-ymme__spinner--inline';
          display.appendChild(spinner);
          var text = document.createElement('span');
          text.textContent = 'Loading...';
          display.appendChild(text);
        }
      },
      setError: function () {
        trigger.disabled = true;
        setDisplay('Error loading makes', null, null);
      },
      enable: function () {
        trigger.disabled = false;
      },
      getSelected: function () { return selectedMake; }
    };
  }

  // --------------- Field loading spinners ---------------

  function showFieldSpinner(container, level) {
    var spinner = container.querySelector('[data-autosync-field-spinner="' + level + '"]');
    if (spinner) spinner.classList.add('autosync-ymme__field-spinner--active');
  }

  function hideFieldSpinner(container, level) {
    var spinner = container.querySelector('[data-autosync-field-spinner="' + level + '"]');
    if (spinner) spinner.classList.remove('autosync-ymme__field-spinner--active');
  }

  // --------------- Garage UI ---------------

  function renderGarageUI(container) {
    var garageEl = container.querySelector('[data-autosync-garage]');
    if (!garageEl) return;

    var vehiclesEl = garageEl.querySelector('[data-autosync-garage-vehicles]');
    var emptyEl = garageEl.querySelector('[data-autosync-garage-empty]');
    var garage = getGarage();

    if (!vehiclesEl) return;
    clearChildren(vehiclesEl);

    if (garage.length === 0) {
      garageEl.classList.add('autosync-ymme__garage--empty');
      if (emptyEl) emptyEl.style.display = '';
      return;
    }

    garageEl.classList.remove('autosync-ymme__garage--empty');
    if (emptyEl) emptyEl.style.display = 'none';

    garage.forEach(function (v, idx) {
      var chip = document.createElement('div');
      chip.className = 'autosync-ymme__garage-chip';

      var info = document.createElement('div');
      info.className = 'autosync-ymme__garage-chip-info';

      var name = document.createElement('span');
      name.className = 'autosync-ymme__garage-chip-name';
      name.textContent = v.year + ' ' + v.makeName + ' ' + v.modelName;
      info.appendChild(name);

      if (v.engineName) {
        var engine = document.createElement('span');
        engine.className = 'autosync-ymme__garage-chip-engine';
        engine.textContent = v.engineName;
        info.appendChild(engine);
      }

      chip.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'autosync-ymme__garage-chip-actions';

      var selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'autosync-ymme__garage-select-btn';
      selectBtn.textContent = 'Select';
      selectBtn.title = 'Load this vehicle';
      selectBtn.addEventListener('click', function () {
        storeVehicle(v);

        // Mark session source
        try { sessionStorage.setItem('autosync_search_source', 'garage'); } catch (e) { /* */ }

        var searchQuery = encodeURIComponent(v.makeName + ' ' + v.modelName);
        window.location.href = '/search?q=' + searchQuery + '&type=product';
      });
      actions.appendChild(selectBtn);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'autosync-ymme__garage-remove-btn';
      removeBtn.title = 'Remove vehicle';
      // Build SVG X icon via DOM
      var xIcon = createSvgIcon(12, 12, [
        { d: 'M9 3L3 9', stroke: 'currentColor', strokeWidth: '1.5', linecap: 'round' },
        { d: 'M3 3l6 6', stroke: 'currentColor', strokeWidth: '1.5', linecap: 'round' }
      ]);
      removeBtn.appendChild(xIcon);
      removeBtn.addEventListener('click', function () {
        removeFromGarage(idx);
        renderGarageUI(container);
      });
      actions.appendChild(removeBtn);

      chip.appendChild(actions);
      vehiclesEl.appendChild(chip);
    });
  }

  // --------------- YMME Search ---------------

  function initYmmeSearch(container) {
    var proxyUrl = container.dataset.proxyUrl;
    if (!proxyUrl) return;

    var showLogos = container.dataset.showLogos !== 'false';
    var showGarage = container.dataset.showGarage !== 'false';
    var showEngine = container.dataset.showEngine !== 'false';

    var makeSelect = container.querySelector('[data-autosync-level="make"]');
    var modelSelect = container.querySelector('[data-autosync-level="model"]');
    var yearSelect = container.querySelector('[data-autosync-level="year"]');
    var engineSelect = container.querySelector('[data-autosync-level="engine"]');
    var searchBtn = container.querySelector('[data-autosync-search]');

    if (!makeSelect) return;

    // State
    var state = { make: null, makeName: '', model: null, modelName: '', year: null, engine: null, engineName: '' };
    var customMakeDropdown = null;
    var allMakesData = [];

    // Load makes
    var customSelectEl = container.querySelector('[data-autosync-custom-select="make"]');
    if (customSelectEl) {
      // Use custom dropdown with logos
      customMakeDropdown = buildCustomMakeDropdown(container, [], showLogos);
      if (customMakeDropdown) customMakeDropdown.setLoading();
    } else {
      setSelectLoading(makeSelect);
    }

    proxyFetch(proxyUrl, 'makes').then(function (data) {
      allMakesData = data.makes || [];

      if (customMakeDropdown) {
        // Rebuild with actual data
        customMakeDropdown = buildCustomMakeDropdown(container, allMakesData, showLogos);
      } else {
        clearChildren(makeSelect);
        makeSelect.appendChild(addOption(makeSelect, '', 'Select Make'));
        allMakesData.forEach(function (m) {
          var opt = addOption(makeSelect, m.id, escapeText(m.name));
          makeSelect.appendChild(opt);
        });
        makeSelect.disabled = false;
      }
    }).catch(function () {
      if (customMakeDropdown) {
        customMakeDropdown.setError();
      } else {
        clearChildren(makeSelect);
        makeSelect.appendChild(addOption(makeSelect, '', 'Error loading makes'));
      }
    });

    // Cascade: Make -> Models
    makeSelect.addEventListener('change', function () {
      state.make = this.value;
      state.makeName = this.options[this.selectedIndex] ? this.options[this.selectedIndex].textContent : '';
      resetSelect(modelSelect, 'Select Model');
      resetSelect(yearSelect, 'Select Year');
      if (engineSelect) resetSelect(engineSelect, 'Select Engine (optional)');
      if (searchBtn) searchBtn.disabled = true;
      hideSaveGarage(container);

      if (!state.make) return;

      setSelectLoading(modelSelect);
      showFieldSpinner(container, 'model');
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
        hideFieldSpinner(container, 'model');
      }).catch(function () {
        clearChildren(modelSelect);
        modelSelect.appendChild(addOption(modelSelect, '', 'Error loading models'));
        hideFieldSpinner(container, 'model');
      });
    });

    // Cascade: Model -> Years
    modelSelect.addEventListener('change', function () {
      state.model = this.value;
      var selected = this.options[this.selectedIndex];
      state.modelName = (selected && selected.dataset.name) ? selected.dataset.name : (selected ? selected.textContent : '');
      resetSelect(yearSelect, 'Select Year');
      if (engineSelect) resetSelect(engineSelect, 'Select Engine (optional)');
      if (searchBtn) searchBtn.disabled = true;
      hideSaveGarage(container);

      if (!state.model) return;

      setSelectLoading(yearSelect);
      showFieldSpinner(container, 'year');
      proxyFetch(proxyUrl, 'years', { model_id: state.model }).then(function (data) {
        clearChildren(yearSelect);
        yearSelect.appendChild(addOption(yearSelect, '', 'Select Year'));
        (data.years || []).forEach(function (y) {
          yearSelect.appendChild(addOption(yearSelect, y, String(y)));
        });
        yearSelect.disabled = false;
        hideFieldSpinner(container, 'year');
      }).catch(function () {
        clearChildren(yearSelect);
        yearSelect.appendChild(addOption(yearSelect, '', 'Error loading years'));
        hideFieldSpinner(container, 'year');
      });
    });

    // Cascade: Year -> Engines
    yearSelect.addEventListener('change', function () {
      state.year = this.value;
      if (engineSelect) resetSelect(engineSelect, 'Select Engine (optional)');
      if (searchBtn) searchBtn.disabled = !state.year;
      hideSaveGarage(container);

      if (!state.year) return;

      if (engineSelect && showEngine) {
        setSelectLoading(engineSelect);
        showFieldSpinner(container, 'engine');
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
          hideFieldSpinner(container, 'engine');
        }).catch(function () {
          clearChildren(engineSelect);
          engineSelect.appendChild(addOption(engineSelect, '', 'Error loading engines'));
          hideFieldSpinner(container, 'engine');
        });
      }
    });

    if (engineSelect) {
      engineSelect.addEventListener('change', function () {
        state.engine = this.value;
        var selected = this.options[this.selectedIndex];
        state.engineName = (selected && selected.dataset.name) ? selected.dataset.name : '';
      });
    }

    // Search button
    if (searchBtn) {
      searchBtn.addEventListener('click', function () {
        if (!state.make || !state.model || !state.year) return;

        var vehicle = {
          makeId: state.make,
          makeName: state.makeName,
          modelId: state.model,
          modelName: state.modelName,
          year: state.year,
          engineId: state.engine || null,
          engineName: state.engineName || null,
        };

        storeVehicle(vehicle);

        // Mark session as coming from YMME widget for source attribution
        try {
          sessionStorage.setItem('autosync_search_source', 'widget');
        } catch (e) { /* ignore */ }

        // Show save to garage button if garage feature is enabled
        if (showGarage) {
          showSaveGarage(container, vehicle);
        }

        var searchQuery = encodeURIComponent(state.makeName + ' ' + state.modelName);
        window.location.href = '/search?q=' + searchQuery + '&type=product';
      });
    }

    // Save to Garage
    var saveGarageBtn = container.querySelector('[data-autosync-save-garage-btn]');
    if (saveGarageBtn) {
      saveGarageBtn.addEventListener('click', function () {
        var vehicle = getStoredVehicle();
        if (vehicle && vehicle.makeName) {
          addToGarage(vehicle);
          renderGarageUI(container);
          hideSaveGarage(container);
        }
      });
    }

    // Clear garage
    var clearGarageBtn = container.querySelector('[data-autosync-garage-clear]');
    if (clearGarageBtn) {
      clearGarageBtn.addEventListener('click', function () {
        clearGarage();
        renderGarageUI(container);
      });
    }

    // Initial garage render
    if (showGarage) {
      renderGarageUI(container);
    }

    // Listen for garage changes from other widgets
    window.addEventListener('autosync:garage-changed', function () {
      renderGarageUI(container);
    });
  }

  function showSaveGarage(container, vehicle) {
    var el = container.querySelector('[data-autosync-save-garage]');
    if (!el) return;
    // Check if already in garage
    var garage = getGarage();
    var key = (vehicle.makeName + '|' + vehicle.modelName + '|' + vehicle.year).toLowerCase();
    for (var i = 0; i < garage.length; i++) {
      var existing = (garage[i].makeName + '|' + garage[i].modelName + '|' + garage[i].year).toLowerCase();
      if (existing === key) return; // already in garage, don't show
    }
    el.style.display = '';
  }

  function hideSaveGarage(container) {
    var el = container.querySelector('[data-autosync-save-garage]');
    if (el) el.style.display = 'none';
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

  // --------------- Conversion Tracking ---------------

  var TRACKING_SESSION_KEY = 'autosync_session_id';

  function getSessionId() {
    try {
      var sid = sessionStorage.getItem(TRACKING_SESSION_KEY);
      if (!sid) {
        sid = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'ses_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(TRACKING_SESSION_KEY, sid);
      }
      return sid;
    } catch (e) { return null; }
  }

  function trackEvent(proxyUrl, eventType, data) {
    if (!proxyUrl) return;
    var vehicle = getStoredVehicle();
    var payload = {
      event: eventType,
      product_id: data.productId || null,
      shopify_product_id: data.shopifyProductId || null,
      vehicle_make: vehicle ? vehicle.makeName : null,
      vehicle_model: vehicle ? vehicle.modelName : null,
      vehicle_year: vehicle ? vehicle.year : null,
      source: data.source || 'widget',
      session_id: getSessionId(),
    };

    // Fire-and-forget — don't block user interaction
    try {
      var url = proxyUrl + (proxyUrl.indexOf('?') !== -1 ? '&' : '?') + 'path=track';
      navigator.sendBeacon
        ? navigator.sendBeacon(url, JSON.stringify(payload))
        : fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(function () {});
    } catch (e) { /* silently ignore */ }
  }

  function initConversionTracking() {
    // Find proxy URL from any widget on the page
    var widgetEl = document.querySelector('[data-proxy-url]');
    var proxyUrl = widgetEl ? widgetEl.dataset.proxyUrl : null;
    if (!proxyUrl) return;

    // --- Track product views ---
    var ogType = document.querySelector('meta[property="og:type"]');
    if (ogType && ogType.content === 'og:product' || ogType && ogType.content === 'product') {
      var productIdMeta = document.querySelector('meta[name="product-id"]') ||
                          document.querySelector('[data-product-id]');
      var shopifyIdMeta = document.querySelector('meta[name="shopify-product-id"]') ||
                          document.querySelector('[data-shopify-product-id]');
      // Determine source — did user arrive via YMME widget search?
      var viewSource = 'direct';
      try {
        var searchSource = sessionStorage.getItem('autosync_search_source');
        if (searchSource) {
          viewSource = searchSource;
          sessionStorage.removeItem('autosync_search_source');
        } else if (document.referrer && document.referrer.indexOf('/search') !== -1) {
          viewSource = 'search';
        }
      } catch (e) { /* ignore */ }

      trackEvent(proxyUrl, 'product_view', {
        productId: productIdMeta ? (productIdMeta.content || productIdMeta.dataset.productId) : null,
        shopifyProductId: shopifyIdMeta ? (shopifyIdMeta.content || shopifyIdMeta.dataset.shopifyProductId) : null,
        source: viewSource,
      });
    }

    // --- Track add-to-cart via fetch interception ---
    var originalFetch = window.fetch;
    if (originalFetch) {
      window.fetch = function () {
        var args = arguments;
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        var isCartAdd = url.indexOf('/cart/add') !== -1;

        var result = originalFetch.apply(this, args);

        if (isCartAdd) {
          result.then(function (response) {
            if (response.ok) {
              trackEvent(proxyUrl, 'add_to_cart', { source: 'direct' });
            }
          }).catch(function () {});
        }

        return result;
      };
    }

    // --- Track add-to-cart via XMLHttpRequest (fallback for older themes) ---
    var originalXhrOpen = XMLHttpRequest.prototype.open;
    var originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._autosyncUrl = url;
      return originalXhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      var self = this;
      if (self._autosyncUrl && self._autosyncUrl.indexOf('/cart/add') !== -1) {
        self.addEventListener('load', function () {
          if (self.status >= 200 && self.status < 300) {
            trackEvent(proxyUrl, 'add_to_cart', { source: 'direct' });
          }
        });
      }
      return originalXhrSend.apply(this, arguments);
    };

    // --- Track form-based add-to-cart (non-AJAX themes) ---
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (form && form.action && form.action.indexOf('/cart/add') !== -1) {
        trackEvent(proxyUrl, 'add_to_cart', { source: 'direct' });
      }
    });

    // Expose globally for merchants who want custom tracking
    window.autosyncTrack = function (eventType, data) {
      trackEvent(proxyUrl, eventType, data || {});
    };
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
    initConversionTracking();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
