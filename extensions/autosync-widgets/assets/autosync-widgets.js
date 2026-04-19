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

  // Note: Despite the name, this does NOT escape HTML entities.
  // All callers use textContent (safe from XSS), not innerHTML.
  // This function strips dedup suffixes like " [92efc5dd]" from engine display names.
  function escapeText(str) {
    if (!str) return '';
    return String(str).replace(/\s*\[[0-9a-f]{8}\]$/, '');
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

  // ── Generic Custom Dropdown ──
  // Converts ANY native <select> into a styled custom dropdown matching the Make dropdown
  function convertToCustomDropdown(selectEl) {
    if (!selectEl || selectEl.dataset.customized) return;
    selectEl.dataset.customized = 'true';

    var parent = selectEl.parentNode;
    var wrapper = document.createElement('div');
    wrapper.className = 'autosync-ymme__custom-select';
    wrapper.style.position = 'relative';

    // Create trigger button
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'autosync-ymme__select-trigger';
    trigger.disabled = selectEl.disabled;

    var display = document.createElement('span');
    display.className = 'autosync-ymme__select-value';
    display.textContent = selectEl.options[selectEl.selectedIndex]?.text || selectEl.options[0]?.text || 'Select...';
    trigger.appendChild(display);

    var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('class', 'autosync-ymme__select-arrow');
    arrow.setAttribute('width', '12');
    arrow.setAttribute('height', '12');
    arrow.setAttribute('viewBox', '0 0 12 12');
    arrow.setAttribute('fill', 'none');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M2.5 4.5L6 8L9.5 4.5');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    arrow.appendChild(path);
    trigger.appendChild(arrow);

    // Create dropdown panel — uses flex layout so inner list can scroll
    var dropdown = document.createElement('div');
    dropdown.className = 'autosync-ymme__select-dropdown';
    dropdown.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:1000;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-height:280px;overflow:hidden;flex-direction:column;animation:autosync-dropdown-in 0.15s ease;';

    var optionsList = document.createElement('ul');
    optionsList.className = 'autosync-ymme__select-options';
    optionsList.style.cssText = 'list-style:none;margin:0;padding:4px 0;overflow-y:auto;flex:1;overscroll-behavior:contain;';

    var isOpen = false;

    function renderOptions() {
      while (optionsList.firstChild) optionsList.removeChild(optionsList.firstChild);
      for (var i = 0; i < selectEl.options.length; i++) {
        var opt = selectEl.options[i];
        var li = document.createElement('li');
        li.className = 'autosync-ymme__select-option';
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.textContent = opt.text;
        if (opt.selected && opt.value) li.classList.add('autosync-ymme__select-option--selected');
        (function(option, listItem) {
          listItem.addEventListener('click', function() {
            selectEl.value = option.value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            display.textContent = option.text;
            closeDD();
            // Update selected state
            var items = optionsList.querySelectorAll('.autosync-ymme__select-option');
            items.forEach(function(it) { it.classList.remove('autosync-ymme__select-option--selected'); });
            listItem.classList.add('autosync-ymme__select-option--selected');
          });
        })(opt, li);
        optionsList.appendChild(li);
      }
    }

    function openDD() {
      if (trigger.disabled) return;
      isOpen = true;
      dropdown.style.display = 'flex';
      wrapper.classList.add('autosync-ymme__custom-select--open');
      trigger.setAttribute('aria-expanded', 'true');
      renderOptions();
    }

    function closeDD() {
      isOpen = false;
      dropdown.style.display = 'none';
      wrapper.classList.remove('autosync-ymme__custom-select--open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      // Close every other open custom dropdown on the page FIRST, before
      // opening this one. Previously we used e.stopPropagation() to stop
      // bubbling to the document listener — but that ALSO stopped the
      // document listener on OTHER dropdowns from firing, so clicking
      // trigger B left A's popup stuck on screen. Manual close-others is
      // more reliable.
      if (!isOpen) {
        var allOpen = document.querySelectorAll('.autosync-ymme__custom-select--open');
        for (var i = 0; i < allOpen.length; i++) {
          var other = allOpen[i];
          if (other !== wrapper) {
            var otherDropdown = other.querySelector('.autosync-ymme__select-dropdown');
            if (otherDropdown) otherDropdown.style.display = 'none';
            var otherTrigger = other.querySelector('.autosync-ymme__select-trigger');
            if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
            other.classList.remove('autosync-ymme__custom-select--open');
          }
        }
      }
      isOpen ? closeDD() : openDD();
    });

    document.addEventListener('click', function(e) {
      if (isOpen && !wrapper.contains(e.target)) closeDD();
    });

    dropdown.appendChild(optionsList);
    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);

    // Hide original select
    selectEl.style.cssText = 'position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;border:0!important;padding:0!important;margin:-1px!important;';

    // Insert wrapper before select, move select inside wrapper
    parent.insertBefore(wrapper, selectEl);
    wrapper.appendChild(selectEl);

    // Watch for external changes to the select (JS updates). When the native
    // select's options list is replaced (e.g. Width cascade after Diameter
    // changes), we must also re-render the custom dropdown's option list IF
    // it is currently open, otherwise the user sees the old/empty options.
    var observer = new MutationObserver(function() {
      display.textContent = selectEl.options[selectEl.selectedIndex]?.text || 'Select...';
      trigger.disabled = selectEl.disabled;
      if (isOpen) renderOptions();
    });
    observer.observe(selectEl, { attributes: true, childList: true, subtree: true });

    // Also listen for change events from JS
    selectEl.addEventListener('change', function() {
      display.textContent = selectEl.options[selectEl.selectedIndex]?.text || 'Select...';
    });

    return wrapper;
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

  /**
   * Redirect to collection page if a matching collection exists,
   * otherwise fall back to Shopify search.
   */
  function redirectToCollection(proxyUrl, makeName, modelName, yearValue, engineName) {
    // Build a conventional collection handle as fallback
    function buildFallbackHandle(make, model) {
      var slug = (make + (model ? ' ' + model : '') + ' parts')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return '/collections/' + slug;
    }

    // Append metafield filters for year + engine (Shopify Search & Discovery)
    function appendFilters(baseUrl) {
      var params = [];
      if (yearValue) {
        params.push('filter.p.m.autosync_fitment.make_names=' + encodeURIComponent(makeName));
        if (modelName) params.push('filter.p.m.autosync_fitment.model_names=' + encodeURIComponent(modelName));
        params.push('filter.p.m.autosync_fitment.make_names=' + encodeURIComponent(makeName));
      }
      // Year and engine filters need the app-owned namespace — get from proxy
      // For now, use tag-based filtering via collection URL which already filters by make+model
      return params.length > 0 ? baseUrl + (baseUrl.includes('?') ? '&' : '?') + params.join('&') : baseUrl;
    }

    if (!proxyUrl || !makeName) {
      window.location.href = buildFallbackHandle(makeName || '', modelName);
      return;
    }

    // Call collection-lookup endpoint — now includes year/engine for potential year-specific collections
    proxyFetch(proxyUrl, 'collection-lookup', {
      make: makeName,
      model: modelName || '',
      year: yearValue || '',
      engine: engineName || '',
    })
      .then(function (data) {
        if (data && data.found && data.url) {
          window.location.href = data.url;
        } else {
          window.location.href = buildFallbackHandle(makeName, modelName);
        }
      })
      .catch(function () {
        window.location.href = buildFallbackHandle(makeName, modelName);
      });
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

    // Accessibility: add ARIA attributes to make dropdown
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

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
      trigger.setAttribute('aria-expanded', 'true');
      renderOptions('');
      if (searchInput) {
        searchInput.value = '';
        setTimeout(function () { searchInput.focus(); }, 50);
      }
    }

    function closeDropdown() {
      isOpen = false;
      customSelect.classList.remove('autosync-ymme__custom-select--open');
      trigger.setAttribute('aria-expanded', 'false');
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
      getSelected: function () { return selectedMake; },
      /** Programmatically select a make by ID (used for restoring saved selection) */
      selectById: function (makeId) {
        var found = null;
        for (var i = 0; i < allMakes.length; i++) {
          if (String(allMakes[i].id) === String(makeId)) { found = allMakes[i]; break; }
        }
        if (!found) return;
        selectedMake = found;
        setDisplay(found.name, found.logo_url, found.name);
        // Sync hidden select
        var hiddenSelect = container.querySelector('[data-autosync-level="make"]');
        if (hiddenSelect) {
          clearChildren(hiddenSelect);
          hiddenSelect.appendChild(addOption(hiddenSelect, '', 'Select Make'));
          var opt = addOption(hiddenSelect, found.id, found.name);
          hiddenSelect.appendChild(opt);
          hiddenSelect.value = found.id;
        }
      }
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

  // --------------- Garage UI (Popover) ---------------

  function updateGarageBadge(container) {
    var badge = container.querySelector('[data-autosync-garage-badge]');
    if (!badge) return;
    var count = getGarage().length;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }

  function renderGarageUI(container) {
    // Render into the popover panel
    var popover = container.querySelector('[data-autosync-garage-popover]');
    if (!popover) return;

    var vehiclesEl = popover.querySelector('[data-autosync-garage-vehicles]');
    var emptyEl = popover.querySelector('[data-autosync-garage-empty]');
    var garage = getGarage();

    if (!vehiclesEl) return;
    clearChildren(vehiclesEl);
    updateGarageBadge(container);

    if (garage.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }

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
        try { sessionStorage.setItem('autosync_search_source', 'garage'); } catch (e) { /* */ }
        var proxyUrl = container.closest('[data-proxy-url]')
          ? container.closest('[data-proxy-url]').dataset.proxyUrl
          : container.dataset.proxyUrl;
        redirectToCollection(proxyUrl, v.makeName, v.modelName, v.year, v.engineName);
      });
      actions.appendChild(selectBtn);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'autosync-ymme__garage-remove-btn';
      removeBtn.title = 'Remove vehicle';
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

  function initGaragePopover(container) {
    var trigger = container.querySelector('[data-autosync-garage-trigger]');
    var popover = container.querySelector('[data-autosync-garage-popover]');
    if (!trigger || !popover) return;

    // Plan check — hide garage if not included in tenant's plan (Business+ only)
    var proxyUrl = container.dataset.proxyUrl;
    if (proxyUrl) {
      checkWidgetPlan(proxyUrl, 'myGarage').then(function (allowed) {
        if (!allowed) { trigger.style.display = 'none'; popover.style.display = 'none'; }
      });
    }

    // Accessibility
    trigger.setAttribute('aria-label', 'Open saved vehicles garage');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    var isOpen = false;

    function open() {
      isOpen = true;
      popover.style.display = '';
      trigger.setAttribute('aria-expanded', 'true');
      renderGarageUI(container);
    }

    function close() {
      isOpen = false;
      popover.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) { close(); } else { open(); }
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (isOpen && !trigger.contains(e.target) && !popover.contains(e.target)) {
        close();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (isOpen && e.key === 'Escape') close();
    });

    // Clear garage button inside popover
    var clearBtn = popover.querySelector('[data-autosync-garage-clear]');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearGarage();
        renderGarageUI(container);
      });
    }

    // Initial badge count
    updateGarageBadge(container);

    // Listen for garage changes from other widgets
    window.addEventListener('autosync:garage-changed', function () {
      updateGarageBadge(container);
      if (isOpen) renderGarageUI(container);
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

    // Convert native selects to custom dropdowns (matching Make dropdown design)
    if (modelSelect) convertToCustomDropdown(modelSelect);
    if (yearSelect) convertToCustomDropdown(yearSelect);
    if (engineSelect) convertToCustomDropdown(engineSelect);

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

    /**
     * Restore the YMME dropdowns from the last stored vehicle selection.
     * This chains API calls: make → models → model → years → year → engines → engine
     * so the widget always shows the user's last selection on every page.
     */
    function restoreLastSelection() {
      var saved = getStoredVehicle();
      if (!saved) return;

      // If we have FULL IDs (makeId + modelId), use fast ID-based restore
      if (saved.makeId && saved.modelId) {
        restoreById(saved);
        return;
      }

      // Otherwise use name-based matching — works for:
      // - Plate lookup that resolved make but not model
      // - VIN decode with partial data
      // - Any case where we have names but incomplete IDs
      if (saved.makeName) {
        restoreByName(saved);
      }
    }

    function restoreById(saved) {
      // Only restore if makes actually loaded — prevents stale localStorage from
      // populating Model/Year/Engine when no data has been pushed to Shopify yet
      if (allMakesData.length === 0) return;

      // Verify the saved make exists in the loaded makes list
      var makeExists = false;
      for (var k = 0; k < allMakesData.length; k++) {
        if (String(allMakesData[k].id) === String(saved.makeId)) { makeExists = true; break; }
      }
      if (!makeExists) return;

      // 1. Set make
      state.make = saved.makeId;
      state.makeName = saved.makeName || '';
      if (customMakeDropdown) {
        customMakeDropdown.selectById(saved.makeId);
      } else {
        makeSelect.value = String(saved.makeId);
      }

      if (!saved.modelId) return;

      // 2. Load models, then set model
      setSelectLoading(modelSelect);
      showFieldSpinner(container, 'model');
      proxyFetch(proxyUrl, 'models', { make_id: saved.makeId }).then(function (data) {
        clearChildren(modelSelect);
        modelSelect.appendChild(addOption(modelSelect, '', 'Select Model'));
        (data.models || []).forEach(function (m) {
          var label = escapeText(m.name);
          if (m.generation && m.generation.indexOf(' | ') === -1 && !m.generation.startsWith(m.name)) label += ' (' + escapeText(m.generation) + ')';
          if (m.year_from) label += ' ' + m.year_from + '-' + (m.year_to || 'present');
          var opt = addOption(modelSelect, m.id, label);
          opt.dataset.name = m.name;
          modelSelect.appendChild(opt);
        });
        modelSelect.disabled = false;
        hideFieldSpinner(container, 'model');

        // Set the saved model
        state.model = saved.modelId;
        state.modelName = saved.modelName || '';
        modelSelect.value = String(saved.modelId);

        if (!saved.year) return;

        // 3. Load years, then set year
        setSelectLoading(yearSelect);
        showFieldSpinner(container, 'year');
        return proxyFetch(proxyUrl, 'years', { model_id: saved.modelId });
      }).then(function (data) {
        if (!data) return;
        clearChildren(yearSelect);
        yearSelect.appendChild(addOption(yearSelect, '', 'Select Year'));
        (data.years || []).forEach(function (y) {
          yearSelect.appendChild(addOption(yearSelect, y, String(y)));
        });
        yearSelect.disabled = false;
        hideFieldSpinner(container, 'year');

        // Set the saved year
        state.year = saved.year;
        yearSelect.value = String(saved.year);
        if (searchBtn) searchBtn.disabled = false;

        // 4. Load engines if applicable
        if (!engineSelect || !showEngine) return;

        setSelectLoading(engineSelect);
        showFieldSpinner(container, 'engine');
        return proxyFetch(proxyUrl, 'engines', { model_id: saved.modelId, year: saved.year });
      }).then(function (data) {
        if (!data || !engineSelect) return;
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

        // Set the saved engine if one was stored
        if (saved.engineId) {
          state.engine = saved.engineId;
          state.engineName = saved.engineName || '';
          engineSelect.value = String(saved.engineId);
        }
      }).catch(function () {
        // Restoration failed — user can still re-select manually
        hideFieldSpinner(container, 'model');
        hideFieldSpinner(container, 'year');
        hideFieldSpinner(container, 'engine');
      });
    }

    /**
     * Restore YMME dropdowns by matching make/model/year by NAME.
     * Used when vehicle data comes from plate lookup or VIN decode (no database IDs).
     */
    function restoreByName(saved) {
      var tMake = (saved.makeName || '').toUpperCase();
      var tModel = (saved.modelName || '').toUpperCase();
      var tYear = saved.year ? String(saved.year) : null;
      if (!tMake || !allMakesData.length) return;

      // Find make by name
      var fMake = null;
      for (var mi = 0; mi < allMakesData.length; mi++) {
        if (allMakesData[mi].name.toUpperCase() === tMake) {
          fMake = allMakesData[mi];
          break;
        }
      }
      if (!fMake) return;

      // Select make
      state.make = fMake.id;
      state.makeName = fMake.name;
      if (customMakeDropdown) {
        customMakeDropdown.selectById(fMake.id);
      } else {
        makeSelect.value = String(fMake.id);
      }

      if (!tModel) return;

      // Fetch models and match by name — supports exact match, prefix match, and substring match
      setSelectLoading(modelSelect);
      showFieldSpinner(container, 'model');
      proxyFetch(proxyUrl, 'models', { make_id: fMake.id }).then(function (data) {
        clearChildren(modelSelect);
        modelSelect.appendChild(addOption(modelSelect, '', 'Select Model'));
        var models = data.models || [];
        var fModel = null;
        var bestSubLen = 0;
        models.forEach(function (m) {
          var label = escapeText(m.name);
          if (m.generation && m.generation.indexOf(' | ') === -1 && !m.generation.startsWith(m.name)) label += ' (' + escapeText(m.generation) + ')';
          if (m.year_from) label += ' ' + m.year_from + '-' + (m.year_to || 'present');
          var opt = addOption(modelSelect, m.id, label);
          opt.dataset.name = m.name;
          modelSelect.appendChild(opt);
          var mn = m.name.toUpperCase();
          // 1. Exact match (highest priority)
          if (mn === tModel) { fModel = m; bestSubLen = 9999; }
          // 2. DVLA model starts with YMME model name (e.g. "XC40 RECHARGE..." starts with "XC40")
          if (!fModel && mn.length >= 2 && tModel.indexOf(mn) === 0 && (tModel.length === mn.length || tModel.charAt(mn.length) === ' ') && mn.length > bestSubLen) {
            fModel = m; bestSubLen = mn.length;
          }
          // 3. YMME model name appears in DVLA model string (longest match wins, avoids "C40" before "XC40")
          if (!fModel || (bestSubLen < 9999 && mn.length > bestSubLen)) {
            if (mn.length >= 3 && tModel.indexOf(mn) !== -1 && mn.length > bestSubLen) {
              fModel = m; bestSubLen = mn.length;
            }
          }
        });
        modelSelect.disabled = false;
        hideFieldSpinner(container, 'model');

        if (!fModel) return;

        state.model = fModel.id;
        state.modelName = fModel.name;
        modelSelect.value = String(fModel.id);

        if (!tYear) return;

        // Fetch years
        setSelectLoading(yearSelect);
        showFieldSpinner(container, 'year');
        return proxyFetch(proxyUrl, 'years', { model_id: fModel.id });
      }).then(function (data) {
        if (!data) return;
        clearChildren(yearSelect);
        yearSelect.appendChild(addOption(yearSelect, '', 'Select Year'));
        var years = data.years || [];
        var foundYear = false;
        years.forEach(function (y) {
          yearSelect.appendChild(addOption(yearSelect, y, String(y)));
          if (String(y) === tYear) foundYear = true;
        });
        yearSelect.disabled = false;
        hideFieldSpinner(container, 'year');

        if (!foundYear) return;

        state.year = tYear;
        yearSelect.value = tYear;
        if (searchBtn) searchBtn.disabled = false;

        // Fetch engines
        if (!engineSelect || !showEngine) return;
        setSelectLoading(engineSelect);
        showFieldSpinner(container, 'engine');
        return proxyFetch(proxyUrl, 'engines', { model_id: state.model, year: tYear });
      }).then(function (data) {
        if (!data || !engineSelect) return;
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
        hideFieldSpinner(container, 'model');
        hideFieldSpinner(container, 'year');
        hideFieldSpinner(container, 'engine');
      });
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

      // After makes are loaded, restore the last YMME selection if any
      restoreLastSelection();
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
          if (m.generation && m.generation.indexOf(' | ') === -1 && !m.generation.startsWith(m.name)) label += ' (' + escapeText(m.generation) + ')';
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

        // Track YMME search event for analytics
        trackEvent(proxyUrl, 'ymme_search', {
          source: 'ymme_widget',
        });

        // Mark session as coming from YMME widget for source attribution
        try {
          sessionStorage.setItem('autosync_search_source', 'widget');
        } catch (e) { /* ignore */ }

        // Auto-save to garage when searching (user can remove later)
        if (showGarage) {
          addToGarage(vehicle);
        }

        // Try collection redirect first, fall back to search
        // Pass year and engine for precise metafield filtering
        redirectToCollection(proxyUrl, state.makeName, state.modelName, state.year, state.engineName);
      });
    }

    // Listen for vehicle changes from plate lookup, VIN decode, garage, etc.
    // This populates the YMME dropdowns when a vehicle is selected on the same page.
    window.addEventListener('autosync:vehicle-changed', function () {
      restoreLastSelection();
    });

    // Initialize garage popover (replaces old inline garage list)
    if (showGarage) {
      initGaragePopover(container);
    }
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

  // Cached widget plan check — runs once per page, shared across all widgets
  var __widgetPlanCache = null;
  function checkWidgetPlan(proxyUrl, widgetType) {
    if (__widgetPlanCache) return __widgetPlanCache.then(function (d) { return d.allowed && d.allowed[widgetType]; });
    __widgetPlanCache = proxyFetch(proxyUrl, 'widget-check', {}).then(function (d) {
      // Auto-hide watermarks if merchant has opted out (paid plan feature)
      if (d.hideWatermark) {
        document.querySelectorAll('.autosync-widget-footer, .apl-footer, .avs-footer, .avsd-footer, .avd-footer').forEach(function (el) {
          el.style.display = 'none';
        });
      }
      return d;
    }).catch(function () { return { allowed: {} }; });
    return __widgetPlanCache.then(function (d) { return d.allowed && d.allowed[widgetType]; });
  }

  function initFitmentBadge(container) {
    var proxyUrl = container.dataset.proxyUrl;
    // Plan check — hide badge if not included in tenant's plan
    if (proxyUrl) {
      checkWidgetPlan(proxyUrl, 'fitmentBadge').then(function (allowed) {
        if (!allowed) container.style.display = 'none';
      });
    }

    var productTags = (container.dataset.productTags || '').toLowerCase();

    // Parse make_names and model_names as JSON arrays (list.single_line_text_field)
    var metaMakeNames = [];
    var metaModelNames = [];
    try {
      var rawMake = container.dataset.productMetafieldMake || '';
      if (rawMake) metaMakeNames = JSON.parse(rawMake).map(function (s) { return s.toLowerCase(); });
    } catch (e) { /* fallback */ }
    try {
      var rawModel = container.dataset.productMetafieldModel || '';
      if (rawModel) metaModelNames = JSON.parse(rawModel).map(function (s) { return s.toLowerCase(); });
    } catch (e) { /* fallback */ }

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
      // Check tags first (fastest)
      if (productTags) {
        fits = productTags.indexOf('_autosync_' + makeLower) !== -1
          || (productTags.indexOf(makeLower) !== -1 && productTags.indexOf(modelLower) !== -1);
      }
      // Check metafield arrays
      if (!fits && metaMakeNames.length > 0) {
        var makeMatch = metaMakeNames.indexOf(makeLower) !== -1;
        var modelMatch = metaModelNames.indexOf(modelLower) !== -1;
        fits = makeMatch && modelMatch;
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
    var proxyUrl = container.dataset.proxyUrl;
    // Plan check — hide compatibility table if not included in tenant's plan
    if (proxyUrl) {
      checkWidgetPlan(proxyUrl, 'compatibilityTable').then(function (allowed) {
        if (!allowed) container.style.display = 'none';
      });
    }

    var metaVehicles = container.dataset.metafieldVehicles;
    var tbody = container.querySelector('[data-autosync-compat-body]');
    if (!tbody) return;

    // Respect the merchant's show_years / show_engine settings from the block.
    // Previously the JS always rendered these columns, so toggling the
    // settings in the theme editor did nothing on the rendered table.
    var showYears = (tbody.dataset.showYears || 'true') !== 'false';
    var showEngine = (tbody.dataset.showEngine || 'true') !== 'false';
    // Column count matches the thead: 2 (make+model) + years? + engine?
    var colCount = 2 + (showYears ? 1 : 0) + (showEngine ? 1 : 0);

    clearChildren(tbody);

    if (!metaVehicles) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.setAttribute('colspan', String(colCount));
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
        noCell.setAttribute('colspan', String(colCount));
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

        if (showYears) {
          var tdYears = document.createElement('td');
          tdYears.textContent = (v.year_from || '') + (v.year_to ? '\u2013' + v.year_to : '+');
          tr.appendChild(tdYears);
        }

        if (showEngine) {
          var tdEngine = document.createElement('td');
          tdEngine.textContent = v.engine ? escapeText(v.engine) : '\u2014';
          tr.appendChild(tdEngine);
        }

        tbody.appendChild(tr);
      });
    } catch (e) {
      var errRow = document.createElement('tr');
      var errCell = document.createElement('td');
      errCell.setAttribute('colspan', String(colCount));
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
                // v is DVLA response: yearOfManufacture (not year), no engine name
                var plateYear = v.yearOfManufacture ? String(v.yearOfManufacture) : '';
                var plateEngine = data.resolvedEngine || ''; // from YMME resolution
                redirectToCollection(proxyUrl, v.make, v.model, plateYear, plateEngine);
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

  // --------------- Wheel Finder (Cascading Dropdowns) ---------------

  function initWheelFinder(container) {
    var proxyUrl = container.dataset.proxyUrl;
    var currencyCode = container.dataset.currencyCode || 'USD';
    var formatter;
    try { formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }); } catch (_e) { formatter = null; }

    var pcdEl = container.querySelector('[data-autosync-wheel-level="pcd"]');
    var diameterEl = container.querySelector('[data-autosync-wheel-level="diameter"]');
    var widthEl = container.querySelector('[data-autosync-wheel-level="width"]');
    var offsetEl = container.querySelector('[data-autosync-wheel-level="offset"]');
    var searchBtn = container.querySelector('[data-autosync-wheel-search]');
    var resultsDiv = container.querySelector('[data-autosync-wheel-results]');

    if (!pcdEl || !searchBtn) return;

    // Convert native selects to custom dropdowns
    if (pcdEl) convertToCustomDropdown(pcdEl);
    if (diameterEl) convertToCustomDropdown(diameterEl);
    if (widthEl) convertToCustomDropdown(widthEl);
    if (offsetEl) convertToCustomDropdown(offsetEl);

    var state = { pcd: '', diameter: '', width: '', offset: '' };
    var btnText = searchBtn.textContent || 'Search Wheels';

    function resetSelect(el, placeholder) {
      clearChildren(el);
      var opt = document.createElement('option');
      opt.value = ''; opt.textContent = placeholder;
      el.appendChild(opt);
      el.disabled = true;
    }

    function populateSelect(el, items, formatter, placeholder) {
      clearChildren(el);
      var defOpt = document.createElement('option');
      defOpt.value = ''; defOpt.textContent = placeholder || 'Select...';
      el.appendChild(defOpt);
      items.forEach(function(item) {
        var opt = document.createElement('option');
        opt.value = String(item);
        opt.textContent = formatter ? formatter(item) : String(item);
        el.appendChild(opt);
      });
      el.disabled = false;
    }

    // Load PCDs on init
    proxyFetch(proxyUrl, 'wheel-pcds', {}).then(function(data) {
      if (data.pcds && data.pcds.length > 0) {
        populateSelect(pcdEl, data.pcds, null, 'Select PCD');
      } else {
        resetSelect(pcdEl, 'No wheels available');
      }
    }).catch(function() { resetSelect(pcdEl, 'Error loading'); });

    // PCD change → load diameters
    pcdEl.addEventListener('change', function() {
      state.pcd = this.value;
      state.diameter = ''; state.width = ''; state.offset = '';
      resetSelect(diameterEl, 'Loading...');
      resetSelect(widthEl, 'Select Diameter first');
      resetSelect(offsetEl, 'Select Width first');
      searchBtn.disabled = !state.pcd;
      if (resultsDiv) { clearChildren(resultsDiv); resultsDiv.classList.add('autosync-wheel-finder--hidden'); }
      if (!state.pcd) { resetSelect(diameterEl, 'Select PCD first'); return; }
      proxyFetch(proxyUrl, 'wheel-diameters', { pcd: state.pcd }).then(function(data) {
        populateSelect(diameterEl, data.diameters || [], function(d) { return d + '"'; }, 'Select Diameter');
      }).catch(function() { resetSelect(diameterEl, 'Error loading'); });
    });

    // Diameter change → load widths
    diameterEl.addEventListener('change', function() {
      state.diameter = this.value;
      state.width = ''; state.offset = '';
      resetSelect(widthEl, 'Loading...');
      resetSelect(offsetEl, 'Select Width first');
      searchBtn.disabled = !state.pcd;
      if (!state.diameter) { resetSelect(widthEl, 'Select Diameter first'); return; }
      proxyFetch(proxyUrl, 'wheel-widths', { pcd: state.pcd, diameter: state.diameter }).then(function(data) {
        populateSelect(widthEl, data.widths || [], function(w) { return w + 'J'; }, 'Select Width');
      }).catch(function() { resetSelect(widthEl, 'Error loading'); });
    });

    // Width change → load offsets + enable search
    widthEl.addEventListener('change', function() {
      state.width = this.value;
      state.offset = '';
      searchBtn.disabled = !state.width;
      resetSelect(offsetEl, 'Loading...');
      if (!state.width) { resetSelect(offsetEl, 'Select Width first'); return; }
      proxyFetch(proxyUrl, 'wheel-offsets', { pcd: state.pcd, diameter: state.diameter, width: state.width }).then(function(data) {
        var offsets = data.offsets || [];
        if (offsets.length > 0) {
          populateSelect(offsetEl, offsets, function(o) { return 'ET' + o; }, 'All Offsets');
        } else {
          resetSelect(offsetEl, 'No offset data');
        }
      }).catch(function() { resetSelect(offsetEl, 'Error'); });
    });

    // Offset change
    offsetEl.addEventListener('change', function() {
      state.offset = this.value;
    });

    // Search button — redirect to Shopify collection with metafield filters
    // Same pattern as YMME: calls proxy to get collection URL with filter params
    // Uses $app:wheel_spec metafields so Search & Discovery shows filter chips
    searchBtn.addEventListener('click', function() {
      if (!state.pcd) return;
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching...';

      // Track wheel search event for analytics
      trackEvent(proxyUrl, 'wheel_search', { source: 'wheel_finder_widget' });

      // Call wheel-lookup proxy endpoint to get collection URL with metafield filters
      var lookupParams = { pcd: state.pcd };
      if (state.diameter) lookupParams.diameter = state.diameter;
      if (state.width) lookupParams.width = state.width;
      if (state.offset) lookupParams.offset = state.offset;

      proxyFetch(proxyUrl, 'wheel-lookup', lookupParams)
        .then(function(data) {
          if (data && data.url) {
            window.location.href = data.url;
          } else {
            // Fallback: search by PCD text
            window.location.href = '/collections/all?q=' + encodeURIComponent(state.pcd);
          }
        })
        .catch(function() {
          // Fallback on error
          window.location.href = '/collections/all?q=' + encodeURIComponent(state.pcd);
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
                redirectToCollection(proxyUrl, v.make, v.model, v.year || '', v.engine || '');
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

    // Watermark hiding is now handled at Liquid render time via shop metafield
    // (shop.metafields['app--334692253697--autosync']['hide_watermark'])
    // No JS needed — zero flash, works for all widgets
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Expose YMME population for cross-widget use (VIN, Plate) ──
  // Resolves make/model names to YMME IDs via the proxy, stores the vehicle,
  // and populates the YMME widget dropdowns.
  window.__autosyncPopulateYMME = async function(proxyUrl, makeName, modelName, year) {
    var ymmeEl = document.querySelector('[data-autosync-ymme]');
    if (!ymmeEl || !proxyUrl) return;

    try {
      // 1. Fetch makes and find the matching one
      var makesData = await proxyFetch(proxyUrl, 'makes', {});
      var makes = makesData.makes || makesData || [];
      if (!Array.isArray(makes)) makes = [];
      var matchedMake = makes.find(function(m) {
        return m.name && m.name.toLowerCase() === (makeName || '').toLowerCase();
      });
      if (!matchedMake) return;

      // 2. Fetch models for this make and find the matching one
      var modelsData = await proxyFetch(proxyUrl, 'models', { make_id: matchedMake.id });
      var models = modelsData.models || [];
      var matchedModel = models.find(function(m) {
        return m.name && m.name.toLowerCase() === (modelName || '').toLowerCase();
      });
      if (!matchedModel) return;

      // 3. Build a resolved vehicle object and store it
      var resolved = {
        makeId: matchedMake.id,
        makeName: matchedMake.name,
        modelId: matchedModel.id,
        modelName: matchedModel.name,
        year: String(year || ''),
        source: 'vin'
      };
      storeVehicle(resolved);

      // 4. Save to garage
      try {
        var garage = getGarage();
        var isDup = garage.some(function(g) {
          return g.makeName === resolved.makeName && g.modelName === resolved.modelName && g.year === resolved.year;
        });
        if (!isDup) {
          garage.unshift(resolved);
          if (garage.length > GARAGE_MAX) garage = garage.slice(0, GARAGE_MAX);
          saveGarage(garage);
        }
      } catch(e) {}

      // 5. Populate the YMME widget using the same DOM manipulation as plate lookup
      var makeSelect = ymmeEl.querySelector('[data-autosync-level="make"]');
      var modelSelect = ymmeEl.querySelector('[data-autosync-level="model"]');
      var yearSelect = ymmeEl.querySelector('[data-autosync-level="year"]');
      var engineSelect = ymmeEl.querySelector('[data-autosync-level="engine"]');
      var searchBtn = ymmeEl.querySelector('[data-autosync-search]');

      // Set make — update custom dropdown display if present
      var selectDisplay = ymmeEl.querySelector('[data-autosync-select-display]');
      if (selectDisplay) {
        selectDisplay.innerHTML = '';
        var logoUrl = null;
        var selOpts = ymmeEl.querySelectorAll('[data-autosync-select-options] li');
        for (var i = 0; i < selOpts.length; i++) {
          var lid = selOpts[i].getAttribute('data-value');
          if (String(lid) === String(matchedMake.id)) {
            selOpts[i].setAttribute('aria-selected', 'true');
            selOpts[i].classList.add('autosync-ymme__select-option--selected');
            var lImg = selOpts[i].querySelector('img');
            if (lImg) logoUrl = lImg.src;
          } else {
            selOpts[i].removeAttribute('aria-selected');
            selOpts[i].classList.remove('autosync-ymme__select-option--selected');
          }
        }
        if (logoUrl) {
          var lEl = document.createElement('img');
          lEl.src = logoUrl;
          lEl.alt = matchedMake.name || '';
          lEl.width = 20;
          lEl.height = 20;
          lEl.style.marginRight = '6px';
          selectDisplay.appendChild(lEl);
        }
        selectDisplay.appendChild(document.createTextNode(matchedMake.name || ''));
        var trigger = ymmeEl.querySelector('[data-autosync-select-trigger]');
        if (trigger) trigger.disabled = false;
      }

      // Set hidden make select
      if (makeSelect) {
        var mOpts = makeSelect.querySelectorAll('option');
        var mFound = false;
        for (var j = 0; j < mOpts.length; j++) {
          if (String(mOpts[j].value) === String(matchedMake.id)) { makeSelect.value = String(matchedMake.id); mFound = true; break; }
        }
        if (!mFound) {
          var nOpt = document.createElement('option');
          nOpt.value = matchedMake.id;
          nOpt.textContent = matchedMake.name || '';
          makeSelect.appendChild(nOpt);
          makeSelect.value = String(matchedMake.id);
        }
      }

      // Populate model select
      if (modelSelect) {
        while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
        var defOpt = document.createElement('option');
        defOpt.value = '';
        defOpt.textContent = 'Select Model';
        modelSelect.appendChild(defOpt);
        models.forEach(function(m) {
          var o = document.createElement('option');
          o.value = m.id;
          var lb = m.name;
          if (m.generation && m.generation.indexOf(' | ') === -1 && !m.generation.startsWith(m.name)) lb += ' (' + m.generation + ')';
          if (m.year_from) lb += ' ' + m.year_from + '-' + (m.year_to || 'present');
          o.textContent = lb;
          o.dataset.name = m.name;
          modelSelect.appendChild(o);
        });
        modelSelect.disabled = false;
        modelSelect.value = String(matchedModel.id);
      }

      // Populate year select
      if (yearSelect && year) {
        var yearsData = await proxyFetch(proxyUrl, 'years', { model_id: matchedModel.id });
        var years = yearsData.years || [];
        while (yearSelect.firstChild) yearSelect.removeChild(yearSelect.firstChild);
        var defY = document.createElement('option');
        defY.value = '';
        defY.textContent = 'Select Year';
        yearSelect.appendChild(defY);
        years.forEach(function(y) {
          var o = document.createElement('option');
          o.value = y;
          o.textContent = String(y);
          yearSelect.appendChild(o);
        });
        yearSelect.disabled = false;
        yearSelect.value = String(year);
        if (searchBtn) searchBtn.disabled = false;

        // Populate engine select
        if (engineSelect) {
          var enginesData = await proxyFetch(proxyUrl, 'engines', { model_id: matchedModel.id, year: year });
          var engines = enginesData.engines || [];
          while (engineSelect.firstChild) engineSelect.removeChild(engineSelect.firstChild);
          var defE = document.createElement('option');
          defE.value = '';
          defE.textContent = 'Select Engine (optional)';
          engineSelect.appendChild(defE);
          engines.forEach(function(e2) {
            var o = document.createElement('option');
            o.value = e2.id;
            var lb = (e2.name || '').replace(/\s*\[[0-9a-f]{8}\]$/, '');
            if (e2.displacement_cc) lb += ' ' + e2.displacement_cc + 'cc';
            if (e2.fuel_type) lb += ' ' + e2.fuel_type;
            o.textContent = lb;
            engineSelect.appendChild(o);
          });
          engineSelect.disabled = false;
        }
      }
    } catch (err) {
      console.warn('[autosync] __autosyncPopulateYMME error:', err);
    }
  };
})();
