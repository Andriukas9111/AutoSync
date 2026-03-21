import https from 'https';
import http from 'http';

const SUPABASE_URL = 'https://yljgamqudcvvbvidzxqc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsamdhbXF1ZGN2dmJ2aWR6eHFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjIyOTE4OSwiZXhwIjoyMDg3ODA1MTg5fQ.Bo4VvRjN4xGhQsVrM8HV0WknP-KFmwaFRxJxudRRAtA';

// ── Supabase REST helpers ──
async function supabaseGet(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePatch(table, match, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${match}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table}: ${res.status} ${await res.text()}`);
}

// ── Check if a URL actually returns a valid image ──
function checkUrl(url, timeout = 5000) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(checkUrl(res.headers.location, timeout));
          res.resume();
          return;
        }
        const ct = res.headers['content-type'] || '';
        const len = parseInt(res.headers['content-length'] || '0', 10);
        // Must be 200, must look like an image, must have some size
        const ok = res.statusCode === 200 && (ct.includes('image') || ct.includes('octet-stream')) && (len === 0 || len > 100);
        res.resume();
        resolve(ok);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch {
      resolve(false);
    }
  });
}

// ── Generate SVG data URI fallback ──
function generateSvgLogo(name) {
  // Get initials (up to 2 chars)
  const words = name.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
  let initials;
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else {
    initials = name.substring(0, 2).toUpperCase();
  }

  // Deterministic color from name
  let hash = 0;
  for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  const bg = `hsl(${hue}, 45%, 35%)`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" rx="16" fill="${bg}"/>
  <text x="50" y="54" text-anchor="middle" dominant-baseline="central"
        font-family="Arial,Helvetica,sans-serif" font-weight="700"
        font-size="${initials.length === 1 ? 52 : 40}" fill="#fff">${initials}</text>
</svg>`;
  const encoded = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}

// ── Name normalization for URL matching ──
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function simplify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Candidate URLs for a given make name ──
function getCandidateUrls(name) {
  const slug = slugify(name);
  const simple = simplify(name);
  const lower = name.toLowerCase().replace(/\s+/g, '-');
  const spaceless = name.replace(/\s+/g, '');

  // Common brand name mappings for edge cases
  const aliases = {
    'de lorean': ['delorean', 'de-lorean'],
    'lynk & co': ['lynk-co', 'lynk-and-co', 'lynkco'],
    'gordon murray': ['gordon-murray', 'gordonmurray'],
    'iran khodro': ['iran-khodro', 'ikco', 'irankhodro'],
    'monte carlo': ['montecarlo', 'monte-carlo'],
    'mw motors': ['mw-motors', 'mwmotors'],
    'sin cars': ['sincars', 'sin-cars'],
    'sono motors': ['sono-motors', 'sonomotors', 'sono'],
    'xin kai': ['xinkai', 'xin-kai'],
    'changan nevo': ['changan-nevo', 'changannevo', 'changan'],
    'bee bee': ['beebee', 'bee-bee'],
    'baltijas dzips': ['baltijas-dzips', 'baltijasdzips'],
    'eadon green': ['eadon-green', 'eadongreen'],
    'gfg style': ['gfg-style', 'gfgstyle'],
    'invicta electric': ['invicta-electric', 'invictaelectric', 'invicta'],
    'spyros panopoulos': ['spyros-panopoulos', 'spyrospanopoulos'],
  };

  const urls = [];
  const names = [slug, simple, lower, spaceless];
  const lowerName = name.toLowerCase();
  if (aliases[lowerName]) names.push(...aliases[lowerName]);

  for (const n of [...new Set(names)]) {
    // GitHub car-logos-dataset
    urls.push(`https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/${n}.png`);
    // Another GitHub logos repo
    urls.push(`https://raw.githubusercontent.com/dangnelson/car-makes-icons/master/svgs/${n}.svg`);
  }

  // auto-data.net uses original casing
  urls.push(`https://www.auto-data.net/img/logos/${name.replace(/\s+/g, '_')}.png`);
  urls.push(`https://www.auto-data.net/img/logos/${name.replace(/\s+/g, '%20')}.png`);
  urls.push(`https://www.auto-data.net/img/logos/${name}.png`);

  // Clearbit (tries brand.com domain)
  const domain = simple.replace(/-/g, '');
  urls.push(`https://logo.clearbit.com/${domain}.com`);
  urls.push(`https://logo.clearbit.com/${slug}.com`);

  // Wikimedia common patterns
  urls.push(`https://upload.wikimedia.org/wikipedia/commons/thumb/${encodeURIComponent(name)}_logo.svg/200px-${encodeURIComponent(name)}_logo.svg.png`);

  return [...new Set(urls)];
}

// ── Main ──
async function main() {
  console.log('Fetching all makes from ymme_makes...');
  const makes = await supabaseGet('ymme_makes', 'select=id,name,logo_url&order=name.asc&limit=1000');
  console.log(`Total makes: ${makes.length}`);

  const missing = makes.filter(m => !m.logo_url || m.logo_url.trim() === '');
  console.log(`Makes with no logo_url: ${missing.length}`);
  if (missing.length > 0) {
    console.log('  Missing:', missing.map(m => m.name).join(', '));
  }

  // Also check existing URLs for broken ones (sample check)
  const withLogo = makes.filter(m => m.logo_url && m.logo_url.trim() !== '');
  console.log(`\nSpot-checking existing logo URLs for broken ones...`);

  // Check data URI logos (those are SVG fallbacks from before - they're fine)
  const dataUriLogos = withLogo.filter(m => m.logo_url.startsWith('data:'));
  const httpLogos = withLogo.filter(m => !m.logo_url.startsWith('data:'));
  console.log(`  ${dataUriLogos.length} have data URI logos (SVG fallbacks)`);
  console.log(`  ${httpLogos.length} have HTTP URL logos`);

  // Check all HTTP logos for broken URLs
  const broken = [];
  const batchSize = 10;
  for (let i = 0; i < httpLogos.length; i += batchSize) {
    const batch = httpLogos.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (m) => {
      const ok = await checkUrl(m.logo_url);
      return { make: m, ok };
    }));
    for (const r of results) {
      if (!r.ok) {
        broken.push(r.make);
        process.stdout.write(`  BROKEN: ${r.make.name} → ${r.make.logo_url}\n`);
      }
    }
    process.stdout.write(`  Checked ${Math.min(i + batchSize, httpLogos.length)}/${httpLogos.length}\r`);
  }
  console.log(`\n  Found ${broken.length} broken HTTP logo URLs`);

  // Combine all makes that need fixing
  const toFix = [...missing, ...broken];
  console.log(`\nTotal makes to fix: ${toFix.length}`);

  if (toFix.length === 0) {
    console.log('All makes have valid logos!');
    return;
  }

  let fixedWithUrl = 0;
  let fixedWithSvg = 0;

  for (const make of toFix) {
    const candidates = getCandidateUrls(make.name);
    let foundUrl = null;

    for (const url of candidates) {
      const ok = await checkUrl(url);
      if (ok) {
        foundUrl = url;
        break;
      }
    }

    if (foundUrl) {
      console.log(`  ✓ ${make.name} → found real logo: ${foundUrl}`);
      await supabasePatch('ymme_makes', `id=eq.${make.id}`, { logo_url: foundUrl });
      fixedWithUrl++;
    } else {
      // Generate SVG fallback
      const svg = generateSvgLogo(make.name);
      console.log(`  ○ ${make.name} → generated SVG fallback`);
      await supabasePatch('ymme_makes', `id=eq.${make.id}`, { logo_url: svg });
      fixedWithSvg++;
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Fixed with real logo URL: ${fixedWithUrl}`);
  console.log(`Fixed with SVG fallback: ${fixedWithSvg}`);
  console.log(`Total fixed: ${fixedWithUrl + fixedWithSvg}`);

  // Final verification
  const remaining = await supabaseGet('ymme_makes', 'select=id,name,logo_url&logo_url=is.null&limit=100');
  const emptyLogo = await supabaseGet('ymme_makes', 'select=id,name,logo_url&logo_url=eq.&limit=100');
  console.log(`\nVerification — makes still without logo: ${remaining.length + emptyLogo.length}`);
  if (remaining.length + emptyLogo.length > 0) {
    console.log('  Still missing:', [...remaining, ...emptyLogo].map(m => m.name).join(', '));
  } else {
    console.log('SUCCESS: Every single make now has a logo_url!');
  }
}

main().catch(console.error);
