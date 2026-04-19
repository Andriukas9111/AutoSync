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
    var MAX_VEHICLES = parseInt(container.getAttribute('data-max-vehicles'), 10) || 0;
    var GRID_ROWS = parseInt(container.getAttribute('data-grid-rows'), 10) || 4;
    var colsSetting = (gridEl && gridEl.getAttribute('data-columns')) || 'auto';

    /* ── State ─────────────────────────────────────── */
    var currentPage = 1;
    var currentVehicles = [];
    var scrollWrap = null;
    var loadMoreWrap = null;

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
      if (loadMoreWrap) loadMoreWrap.style.display = 'none';
    }

    /* SVG parser for hardcoded icon markup only */
    function svgEl(svgMarkup) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
      return doc.documentElement;
    }

    /* ── Calculate scroll container max-height ─────── */
    function calcScrollHeight() {
      if (GRID_ROWS <= 0) return 'none';
      /* Card ~180px + 18px gap per row */
      return (GRID_ROWS * 198 + 20) + 'px';
    }

    /* ── Render Grid ───────────────────────────────── */
    function renderGrid(vehicles) {
      /* Apply max vehicle limit */
      if (MAX_VEHICLES > 0 && vehicles.length > MAX_VEHICLES) {
        vehicles = vehicles.slice(0, MAX_VEHICLES);
      }

      currentVehicles = vehicles;
      currentPage = 1;
      loadingEl.style.display = 'none';
      emptyEl.style.display = 'none';

      /* Create scroll wrapper if not exists */
      if (!scrollWrap) {
        scrollWrap = document.createElement('div');
        scrollWrap.className = 'avs-scroll-wrap';
        gridEl.parentNode.insertBefore(scrollWrap, gridEl);
        scrollWrap.appendChild(gridEl);
      }
      scrollWrap.style.display = 'block';

      var maxH = calcScrollHeight();
      if (maxH !== 'none') {
        scrollWrap.style.maxHeight = maxH;
        scrollWrap.style.overflowY = 'auto';
      } else {
        scrollWrap.style.maxHeight = 'none';
        scrollWrap.style.overflowY = 'visible';
      }

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

      /* Remove old Load More */
      if (loadMoreWrap) { loadMoreWrap.remove(); loadMoreWrap = null; }

      /* Render first batch */
      renderCards(vehicles.slice(0, PER_PAGE), showLogos, showSpecs);

      /* Show Load More button if there are more */
      if (vehicles.length > PER_PAGE) {
        showLoadMore(showLogos, showSpecs);
      }
    }

    /* ── Load More Button (inside scroll container) ── */
    function showLoadMore(showLogos, showSpecs) {
      if (loadMoreWrap) loadMoreWrap.remove();

      loadMoreWrap = document.createElement('div');
      loadMoreWrap.className = 'avs-load-more-wrap';

      var remaining = currentVehicles.length - (currentPage * PER_PAGE);
      var btn = document.createElement('button');
      btn.className = 'avs-load-more-btn';
      btn.type = 'button';
      btn.textContent = 'Load More (' + remaining + ' remaining)';

      btn.addEventListener('click', function() {
        currentPage++;
        var s = (currentPage - 1) * PER_PAGE;
        var batch = currentVehicles.slice(s, s + PER_PAGE);

        /* Remove the button wrap temporarily */
        if (loadMoreWrap) loadMoreWrap.remove();

        /* Render next batch into the grid */
        renderCards(batch, showLogos, showSpecs);

        /* Check if more remain */
        var newRemaining = currentVehicles.length - (currentPage * PER_PAGE);
        if (newRemaining > 0) {
          showLoadMore(showLogos, showSpecs);
          /* Scroll to where new cards start */
          var cards = gridEl.querySelectorAll('.avs-card');
          if (cards.length > 0) {
            var targetCard = cards[cards.length - batch.length];
            if (targetCard && scrollWrap.style.overflowY === 'auto') {
              setTimeout(function() {
                targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }, 100);
            }
          }
        }
      });

      loadMoreWrap.appendChild(btn);
      /* Place Load More INSIDE the scroll wrapper, after the grid */
      scrollWrap.appendChild(loadMoreWrap);
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
            if (loadMoreWrap) { loadMoreWrap.remove(); loadMoreWrap = null; }
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