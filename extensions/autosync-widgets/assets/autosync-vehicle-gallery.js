(function() {
    var container = document.querySelector('[data-autosync-vehicle-showcase]');
    if (!container) return;

    var proxyUrl = container.dataset.proxyUrl;
    var loadingEl = container.querySelector('[data-avs-loading]');
    var emptyEl = container.querySelector('[data-avs-empty]');
    var gridEl = container.querySelector('[data-avs-grid]');
    var searchInput = container.querySelector('[data-avs-search]');
    var countEl = container.querySelector('[data-avs-count]');
    var allVehicles = [];

    /* ── Settings from data attributes ────────────── */
    var PER_PAGE = parseInt(container.getAttribute('data-per-page'), 10) || 18;
    var MAX_VEHICLES = parseInt(container.getAttribute('data-max-vehicles'), 10) || 0; // 0 = unlimited
    var GRID_ROWS = parseInt(container.getAttribute('data-grid-rows'), 10) || 0; // 0 = unlimited height
    var colsSetting = (gridEl && gridEl.getAttribute('data-columns')) || 'auto';

    /* ── State ─────────────────────────────────────── */
    var currentPage = 1;
    var currentVehicles = [];
    var isLoading = false;
    var observer = null;
    var sentinelEl = null;
    var scrollWrap = null;

    if (!proxyUrl) { showEmpty(); return; }
    fetchGallery();

    function fetchGallery() {
      var url = new URL(proxyUrl);
      url.searchParams.set('path', 'vehicle-gallery');
      fetch(url.toString())
        .then(function(resp) {
          if (!resp.ok) throw new Error('Failed');
          return resp.json();
        })
        .then(function(data) {
          allVehicles = data.vehicles || [];
          if (allVehicles.length === 0) {
            showEmpty();
          } else {
            renderGrid(allVehicles);
          }
        })
        .catch(function() { showEmpty(); });
    }

    function showEmpty() {
      loadingEl.style.display = 'none';
      emptyEl.style.display = 'block';
      gridEl.style.display = 'none';
      if (scrollWrap) scrollWrap.style.display = 'none';
    }

    /* SVG parser for hardcoded icon markup only (never used with API data) */
    function svgEl(svgMarkup) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
      return doc.documentElement;
    }

    /* ── Calculate scroll container height ──────────── */
    function calcScrollHeight() {
      if (GRID_ROWS <= 0) return 'none';
      /* Estimate card height (~180px) + gap (18px) per row */
      var cardH = 180;
      var gap = 18;
      return (GRID_ROWS * cardH + (GRID_ROWS - 1) * gap + 20) + 'px';
    }

    /* ── Render Grid with Infinite Scroll ──────────── */
    function renderGrid(vehicles) {
      /* Apply max vehicle limit */
      if (MAX_VEHICLES > 0 && vehicles.length > MAX_VEHICLES) {
        vehicles = vehicles.slice(0, MAX_VEHICLES);
      }

      currentVehicles = vehicles;
      currentPage = 1;
      isLoading = false;
      loadingEl.style.display = 'none';
      emptyEl.style.display = 'none';

      /* Destroy old observer if exists */
      if (observer) { observer.disconnect(); observer = null; }

      /* Set up scroll wrapper */
      if (!scrollWrap) {
        scrollWrap = document.createElement('div');
        scrollWrap.className = 'avs-scroll-wrap';
        gridEl.parentNode.insertBefore(scrollWrap, gridEl);
        scrollWrap.appendChild(gridEl);
      }
      scrollWrap.style.display = 'block';

      var maxH = calcScrollHeight();
      scrollWrap.style.maxHeight = maxH;
      scrollWrap.style.overflowY = maxH === 'none' ? 'visible' : 'auto';

      /* Grid setup */
      gridEl.style.display = 'grid';
      gridEl.textContent = '';

      if (colsSetting === 'auto') {
        gridEl.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
      } else {
        gridEl.style.gridTemplateColumns = 'repeat(' + colsSetting + ', 1fr)';
      }

      var showLogos = container.getAttribute('data-show-logos') !== 'false';
      var showSpecs = container.getAttribute('data-show-specs') !== 'false';

      if (countEl) countEl.textContent = vehicles.length + ' vehicle' + (vehicles.length !== 1 ? 's' : '');

      /* Render first batch */
      renderCards(vehicles.slice(0, PER_PAGE), showLogos, showSpecs);

      /* Set up infinite scroll if more items exist */
      if (vehicles.length > PER_PAGE) {
        createSentinel();
        observeSentinel(showLogos, showSpecs);
      }
    }

    /* ── Create sentinel element for IntersectionObserver ── */
    function createSentinel() {
      if (sentinelEl) sentinelEl.remove();
      sentinelEl = document.createElement('div');
      sentinelEl.className = 'avs-sentinel';
      sentinelEl.setAttribute('data-avs-sentinel', '');
      gridEl.appendChild(sentinelEl);
    }

    /* ── Observe sentinel to trigger loading ────────── */
    function observeSentinel(showLogos, showSpecs) {
      var scrollRoot = scrollWrap && scrollWrap.style.overflowY === 'auto' ? scrollWrap : null;

      observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting || isLoading) return;

          var totalShown = currentPage * PER_PAGE;
          if (totalShown >= currentVehicles.length) {
            /* All loaded — remove sentinel */
            if (sentinelEl) sentinelEl.remove();
            observer.disconnect();
            return;
          }

          isLoading = true;
          /* Show loading indicator at bottom */
          if (sentinelEl) {
            sentinelEl.innerHTML = '<div class="avs-loading-more"><div class="avs-spinner avs-spinner--sm"></div></div>';
          }

          /* Small delay for smooth feel */
          setTimeout(function() {
            currentPage++;
            var s = (currentPage - 1) * PER_PAGE;
            var batch = currentVehicles.slice(s, s + PER_PAGE);

            /* Remove sentinel temporarily */
            if (sentinelEl) sentinelEl.remove();

            /* Render new cards */
            renderCards(batch, showLogos, showSpecs);

            /* Check if more to load */
            var totalNow = currentPage * PER_PAGE;
            if (totalNow < currentVehicles.length) {
              createSentinel();
            }

            isLoading = false;
          }, 200);
        });
      }, {
        root: scrollRoot,
        rootMargin: '200px',
        threshold: 0
      });

      if (sentinelEl) observer.observe(sentinelEl);
    }

    /* ── Render batch of cards ──────────────────────── */
    function renderCards(vehicles, showLogos, showSpecs) {
      vehicles.forEach(function(v, idx) {
        var card = document.createElement('a');
        card.href = v.url;
        card.className = 'avs-card';
        card.style.animationDelay = Math.min(idx * 0.04, 0.6) + 's';

        var header = document.createElement('div');
        header.className = 'avs-card__header';

        if (showLogos) {
          var logo = document.createElement('div');
          logo.className = 'avs-card__logo';

          if (v.logoUrl) {
            var img = document.createElement('img');
            img.src = v.logoUrl;
            img.alt = (v.make || '') + ' logo';
            img.loading = 'lazy';
            img.onerror = function() {
              this.parentNode.removeChild(this);
              var fb = document.createElement('span');
              fb.className = 'avs-card__logo-fallback';
              fb.textContent = (v.make || '??').substring(0, 2).toUpperCase();
              logo.appendChild(fb);
            };
            logo.appendChild(img);
          } else {
            var fallback = document.createElement('span');
            fallback.className = 'avs-card__logo-fallback';
            fallback.textContent = (v.make || '??').substring(0, 2).toUpperCase();
            logo.appendChild(fallback);
          }
          header.appendChild(logo);
        }

        var titles = document.createElement('div');
        titles.className = 'avs-card__titles';

        var makeP = document.createElement('p');
        makeP.className = 'avs-card__make';
        makeP.textContent = v.make || '';
        titles.appendChild(makeP);

        var modelP = document.createElement('p');
        modelP.className = 'avs-card__model';
        modelP.textContent = v.model || '';
        titles.appendChild(modelP);

        if (v.variant) {
          var variantP = document.createElement('p');
          variantP.className = 'avs-card__variant';
          variantP.textContent = v.variant;
          titles.appendChild(variantP);
        }

        header.appendChild(titles);
        card.appendChild(header);

        if (showSpecs) {
          var specs = document.createElement('div');
          specs.className = 'avs-card__specs';

          if (v.powerHp) {
            var pill1 = document.createElement('span');
            pill1.className = 'avs-card__pill avs-card__pill--power';
            pill1.appendChild(svgEl('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'));
            var pill1Text = document.createElement('span');
            pill1Text.textContent = v.powerHp + ' HP';
            pill1.appendChild(pill1Text);
            specs.appendChild(pill1);
          }
          if (v.displacement) {
            var pill2 = document.createElement('span');
            pill2.className = 'avs-card__pill';
            pill2.appendChild(svgEl('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>'));
            var pill2Text = document.createElement('span');
            pill2Text.textContent = v.displacement;
            pill2.appendChild(pill2Text);
            specs.appendChild(pill2);
          }
          if (v.fuelType) {
            var pill3 = document.createElement('span');
            pill3.className = 'avs-card__pill';
            pill3.appendChild(svgEl('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C12 2 7 8 7 13a5 5 0 0 0 10 0c0-5-5-11-5-11Z"/></svg>'));
            var pill3Text = document.createElement('span');
            pill3Text.textContent = v.fuelType;
            pill3.appendChild(pill3Text);
            specs.appendChild(pill3);
          }

          if (specs.childNodes.length > 0) {
            card.appendChild(specs);
          }
        }

        var footer = document.createElement('div');
        footer.className = 'avs-card__footer';

        var link = document.createElement('span');
        link.className = 'avs-card__link';
        var linkText = document.createElement('span');
        linkText.textContent = 'View Specs';
        link.appendChild(linkText);
        link.appendChild(svgEl('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'));
        footer.appendChild(link);

        card.appendChild(footer);
        gridEl.appendChild(card);
      });
    }

    /* ── Search/Filter ─────────────────────────────── */
    if (searchInput) {
      var debounceTimer;
      searchInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          var q = searchInput.value.toLowerCase().trim();
          if (!q) {
            renderGrid(allVehicles);
            return;
          }
          var filtered = allVehicles.filter(function(v) {
            var text = [v.make, v.model, v.variant, v.fuelType, v.displacement]
              .filter(Boolean).join(' ').toLowerCase();
            return text.indexOf(q) !== -1;
          });
          if (filtered.length === 0) {
            gridEl.style.display = 'none';
            emptyEl.style.display = 'block';
            if (scrollWrap) scrollWrap.style.display = 'none';
            var titleEl = emptyEl.querySelector('.avs-empty__title');
            if (titleEl) {
              titleEl.textContent = 'No vehicles match "' + searchInput.value + '"';
            }
            if (countEl) countEl.textContent = '0 vehicles';
          } else {
            emptyEl.style.display = 'none';
            renderGrid(filtered);
          }
        }, 150);
      });
    }
  })();