'use strict';

/**
 * Atlassian Marketplace Compatibility Scraper
 * =============================================
 *
 * DATA SOURCES (tried in order per plugin):
 *
 * 1. <script id="initial-state"> JSON embedded in the page HTML
 * → Most reliable: full data, no rendering race conditions
 *
 * 2. REST API  GET /rest/2/addons/{slug|id}/versions?hosting=datacenter
 * → Structured JSON, paginated, no browser needed
 *
 * 3. Puppeteer with ROBUST DOM selectors:
 * Scrapes the ARIA treegrid.
 */

const puppeteer = require('puppeteer');
const https     = require('https');
const http      = require('http');
const urlMod    = require('url');

// ═══════════════════════════════════════════════════════════════════════════
//  VERSION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/** Matches dotted version tokens including alphanumeric segments */
const VERSION_TOKEN_RE = /[0-9][0-9a-zA-Z]*(?:\.[0-9a-zA-Z]+)+|[a-zA-Z][0-9a-zA-Z]*(?:\.[0-9a-zA-Z]+)+/g;

function parseSegment(seg) {
  seg = String(seg || '').trim().toLowerCase();
  const m = seg.match(/^(\d*)(.*)$/);
  return { num: m[1].length ? parseInt(m[1], 10) : 0, alpha: m[2] };
}

function compareSegments(sa, sb) {
  if (sa.num !== sb.num) return sa.num < sb.num ? -1 : 1;
  if (sa.alpha === sb.alpha) return 0;
  if (sa.alpha === '') return -1;  // "8" < "8a"
  if (sb.alpha === '') return  1;
  return sa.alpha < sb.alpha ? -1 : 1;
}

function parseVersion(vstr) {
  if (!vstr) return [{ num: 0, alpha: '' }];
  return String(vstr).trim().split('.').map(parseSegment);
}

function compareVersions(a, b) {
  const sa = parseVersion(a);
  const sb = parseVersion(b);
  const len = Math.max(sa.length, sb.length);
  const pad = { num: 0, alpha: '' };
  for (let i = 0; i < len; i++) {
    const c = compareSegments(sa[i] || pad, sb[i] || pad);
    if (c !== 0) return c;
  }
  return 0;
}

function isVersionInRange(target, minVer, maxVer) {
  if (!target || !minVer || !maxVer) return false;
  return compareVersions(target, minVer) >= 0 &&
         compareVersions(target, maxVer) <= 0;
}

function extractVersionTokens(text) {
  if (!text) return [];
  VERSION_TOKEN_RE.lastIndex = 0;
  return (String(text).match(VERSION_TOKEN_RE) || []).filter(t => t.includes('.'));
}

function parseCompatibilityString(text) {
  const rawText = String(text || '').trim();
  if (!rawText) return { minVersion: null, maxVersion: null, rawText };
  const tokens = extractVersionTokens(rawText);
  if (!tokens.length) return { minVersion: null, maxVersion: null, rawText };
  if (tokens.length === 1) return { minVersion: tokens[0], maxVersion: tokens[0], rawText };
  let [min, max] = [tokens[0], tokens[tokens.length - 1]];
  if (compareVersions(min, max) > 0) [min, max] = [max, min]; // safety swap
  return { minVersion: min, maxVersion: max, rawText };
}

// ═══════════════════════════════════════════════════════════════════════════
//  URL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function normalizeVersionHistoryUrl(rawUrl) {
  rawUrl = String(rawUrl || '').trim();
  const base = rawUrl.includes('/version-history')
    ? rawUrl.split('?')[0]
    : rawUrl.replace(/\/$/, '') + '/version-history';
  return base + '?versionHistoryHosting=dataCenter';
}

/** * Extract addon ID first (more reliable), then slug.
 * ".../apps/1215215/scriptrunner..." → { id: "1215215", slug: "scriptrunner" }
 */
function extractAddonIdentifiers(marketplaceUrl) {
  try {
    const parts = new urlMod.URL(marketplaceUrl).pathname.split('/').filter(Boolean);
    const appsIdx = parts.indexOf('apps');
    if (appsIdx >= 0) {
      const id = parts[appsIdx + 1];
      const slug = parts[appsIdx + 2];
      // Basic validation to ensure we grabbed meaningful parts
      if (id && /^\d+$/.test(id)) {
         return { id, slug: (slug && !['version-history','overview'].includes(slug)) ? slug : null };
      }
    }
  } catch (_) {}
  return { id: null, slug: null };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HTTP HELPER
// ═══════════════════════════════════════════════════════════════════════════

function httpGet(reqUrl, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new urlMod.URL(reqUrl);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      timeout:  30000,
      headers:  {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Accept':          'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders
      }
    };
    const req = lib.request(options, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        return httpGet(res.headers.location, extraHeaders).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  METHOD 1: INITIAL STATE (HTML)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchFromInitialState(pageUrl, progressCallback) {
  progressCallback('  [Method 1] Fetching page HTML for initial-state JSON...');
  const html = await httpGet(pageUrl, { 'Accept': 'text/html' });

  // Improved regex to capture content more robustly
  const scriptMatch = html.match(/<script[^>]+id=["']initial-state["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('initial-state script tag not found');

  let stateJson;
  try {
    stateJson = JSON.parse(scriptMatch[1]);
  } catch (_) {
    // Sometimes content is HTML-encoded
    try {
        const decoded = scriptMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        stateJson = JSON.parse(decoded);
    } catch (e2) {
        throw new Error('initial-state JSON parse failed');
    }
  }

  const versions = [];
  walkInitialState(stateJson, versions);

  if (!versions.length) throw new Error('No version data found in initial-state');
  progressCallback(`  [Method 1] Found ${versions.length} versions`);
  return versions;
}

function walkInitialState(node, collected, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 15) return;
  if (Array.isArray(node)) {
    for (const item of node) walkInitialState(item, collected, depth + 1);
    return;
  }
  
  // Look for version string
  const versionStr = node.name || node.version || '';
  if (versionStr && /^\d+\.\d+/.test(String(versionStr)) && String(versionStr).length < 25) {
    const entry = extractVersionFromStateNode(node, versionStr);
    if (entry) { collected.push(entry); return; }
  }

  for (const key of Object.keys(node)) {
    walkInitialState(node[key], collected, depth + 1);
  }
}

function extractVersionFromStateNode(node, versionStr) {
  const candidates = [];
  const emb = node._embedded || {};
  if (Array.isArray(emb.compatibilities)) candidates.push(...emb.compatibilities);
  if (Array.isArray(node.compatibility))  candidates.push(...node.compatibility);
  if (Array.isArray(node.compatibilities)) candidates.push(...node.compatibilities);

  const dc = candidates.find(c => {
    const h = String(c.hosting || c.type || '').toLowerCase();
    return h.includes('datacenter') || h.includes('data_center') || h === 'server_and_dc';
  });
  if (!dc) return null;

  const cvEmb = (dc._embedded && dc._embedded.compatibleVersions) || {};
  const min   = dc.min || dc.minVersion || cvEmb.min || '';
  const max   = dc.max || dc.maxVersion || cvEmb.max || '';
  if (!min || !max) return null;

  return {
    version:        String(versionStr),
    compatibility:  `${min} - ${max}`, // Simplified
    releaseDate:    node.releaseDate || (node.release && node.release.date) || '',
    releaseSummary: (node.release && node.release.notes) || node.releaseSummary || '',
    minVersion:     min,
    maxVersion:     max
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  METHOD 2: REST API
// ═══════════════════════════════════════════════════════════════════════════

async function fetchFromAPI(identifiers, progressCallback) {
  const { id, slug } = identifiers;
  // Try ID first if available (more reliable than slug which can change/be messy)
  const resourceKey = id || slug; 
  
  if (!resourceKey) throw new Error('No ID or slug found');

  progressCallback(`  [Method 2] REST API using key: ${resourceKey}`);
  const allVersions = [];
  const LIMIT = 50;
  let offset  = 0;
  
  do {
    const apiUrl = `https://marketplace.atlassian.com/rest/2/addons/${resourceKey}/versions` +
                   `?hosting=datacenter&limit=${LIMIT}&offset=${offset}`;
    
    // Silence detailed logs for pages 2+
    if (offset === 0) progressCallback(`  [Method 2] Requesting: ${apiUrl}`);

    const body = await httpGet(apiUrl);
    const data = JSON.parse(body);
    
    let items = [];
    if (Array.isArray(data._embedded && data._embedded.versions)) items = data._embedded.versions;
    else if (Array.isArray(data.versions)) items = data.versions;
    
    if (!items.length) break;

    for (const v of items) {
      const entry = extractVersionFromStateNode(v, v.name || v.version || '');
      if (entry) allVersions.push(entry);
    }

    offset += LIMIT;
    if (items.length < LIMIT) break; // End of list
    await new Promise(r => setTimeout(r, 400));
  } while (true);

  if (!allVersions.length) throw new Error('API returned 0 DC versions');
  progressCallback(`  [Method 2] Found ${allVersions.length} versions`);
  return allVersions;
}

// ═══════════════════════════════════════════════════════════════════════════
//  METHOD 3: PUPPETEER (ROBUST FALLBACK)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchFromPuppeteer(browser, pageUrl, pluginName, progressCallback) {
  progressCallback(`  [Method 3] Browser rendering: ${pageUrl}`);
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // 1. Wait for Treegrid
    try {
      await page.waitForSelector('[role="treegrid"]', { timeout: 15000 });
    } catch(e) {
      // Fallback to waiting for anything table-like if treegrid fails
      await page.waitForSelector('[role="row"], table', { timeout: 5000 });
    }

    // 2. Click "Load More"
    let loadClicks = 0;
    while (loadClicks < 25) {
      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const loadBtn = buttons.find(b => {
          const t = b.textContent.toLowerCase();
          return t.includes('load more') || t.includes('show more');
        });
        if (loadBtn && !loadBtn.disabled && loadBtn.offsetParent !== null) {
          loadBtn.scrollIntoView({ block: "center" });
          loadBtn.click();
          return true;
        }
        return false;
      });
      if (!clicked) break;
      await new Promise(r => setTimeout(r, 2000));
      loadClicks++;
      if (loadClicks % 5 === 0) progressCallback(`  [Method 3] Expanded history (${loadClicks} clicks)`);
    }

    // 3. Extract Data (Robust Selector Strategy)
    const versions = await page.evaluate(() => {
      const rows = [];
      // Looser selector: find ANY row inside the treegrid, ignore 'aria-expanded' requirements
      // which might be flaky.
      const versionRows = document.querySelectorAll('[role="treegrid"] [role="row"], [role="rowgroup"] [role="row"]');

      versionRows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('[role="gridcell"]'));
        if (cells.length < 3) return;

        // CELL 1: Version
        // Instead of traversing spans, get all text and regex match the first version-like string
        const t1 = cells[0].innerText || cells[0].textContent;
        // Regex: start of line or whitespace, followed by digits.digits...
        const vMatch = t1.match(/(?:^|\s)(\d+\.[0-9a-zA-Z.]+)(?:$|\s)/);
        if (!vMatch) return;
        const version = vMatch[1].trim();

        // CELL 2: Compatibility
        // Often contains "Confluence Data Center 8.0 - 9.0"
        const compatibility = cells[1].innerText || cells[1].textContent;

        // CELL 3: Date
        const releaseDate = cells[2].innerText || cells[2].textContent;

        rows.push({
          version,
          compatibility: compatibility.trim(),
          releaseDate: releaseDate.trim()
        });
      });
      return rows;
    });

    await page.close();

    if (!versions.length) throw new Error('No rows found. DOM selector mismatch.');
    progressCallback(`  [Method 3] Extracted ${versions.length} versions from DOM`);

    return versions.map(v => {
      const parsed = parseCompatibilityString(v.compatibility);
      return {
        ...v,
        minVersion: parsed.minVersion,
        maxVersion: parsed.maxVersion
      };
    });

  } catch (err) {
    try { await page.close(); } catch (_) {}
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

async function fetchAllVersions(browser, plugin, progressCallback) {
  const pageUrl = normalizeVersionHistoryUrl(plugin.marketplaceUrl);
  const identifiers = extractAddonIdentifiers(plugin.marketplaceUrl);
  const errors = [];

  // 1. Initial State
  try {
    const versions = await fetchFromInitialState(pageUrl, progressCallback);
    return { versions, method: 'initial-state' };
  } catch (e) {
    errors.push(`initial-state: ${e.message}`);
  }

  // 2. REST API (Try ID, then Slug)
  if (identifiers.id || identifiers.slug) {
    try {
      const versions = await fetchFromAPI(identifiers, progressCallback);
      return { versions, method: 'rest-api' };
    } catch (e) {
      errors.push(`rest-api: ${e.message}`);
    }
  }

  // 3. Puppeteer
  try {
    const versions = await fetchFromPuppeteer(browser, pageUrl, plugin.name, progressCallback);
    return { versions, method: 'puppeteer' };
  } catch (e) {
    errors.push(`puppeteer: ${e.message}`);
  }

  throw new Error(`All methods failed:\n • ${errors.join('\n • ')}`);
}

function buildResult(plugin, rawVersions, targetDCVersion, fetchMethod) {
  const { name: pluginName, marketplaceUrl: pluginUrl, currentVersion } = plugin;
  const compatibleVersions = [];
  const parseWarnings = [];

  for (const v of rawVersions) {
    let { minVersion, maxVersion } = v;

    // Fallback parsing if missing
    if (!minVersion || !maxVersion) {
      const parsed = parseCompatibilityString(v.compatibility);
      minVersion = parsed.minVersion;
      maxVersion = parsed.maxVersion;
    }

    if (!minVersion || !maxVersion) continue;

    if (isVersionInRange(targetDCVersion, minVersion, maxVersion)) {
      compatibleVersions.push({
        pluginVersion:      v.version,
        compatibilityRange: `${minVersion} - ${maxVersion}`,
        compatibility:      v.compatibility || `${minVersion} - ${maxVersion}`,
        releaseDate:        v.releaseDate    || '',
        releaseSummary:     v.releaseSummary || ''
      });
    }
  }

  const isCurrentVersionCompatible = compatibleVersions.some(cv =>
    compareVersions(cv.pluginVersion, currentVersion) === 0
  );

  let recommendedVersion = null;
  if (compatibleVersions.length > 0) {
    // Sort desc
    recommendedVersion = compatibleVersions.sort((a, b) =>
      compareVersions(b.pluginVersion, a.pluginVersion)
    )[0].pluginVersion;
  }

  let compatibleVersionRange = null;
  if (compatibleVersions.length > 0) {
    const sorted = [...compatibleVersions].sort((a, b) => compareVersions(a.pluginVersion, b.pluginVersion));
    const v1 = sorted[0].pluginVersion;
    const v2 = sorted[sorted.length - 1].pluginVersion;
    compatibleVersionRange = v1 === v2 ? v1 : `${v1} - ${v2}`;
  }

  return {
    pluginName,
    pluginUrl,
    currentVersion,
    targetDCVersion,
    fetchMethod,
    compatible:             isCurrentVersionCompatible,
    compatibleVersions,
    compatibleVersionRange,
    recommendedVersion,
    totalVersionsChecked:   rawVersions.length,
    allVersions:            rawVersions,
    parseWarnings,
    error: null
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

async function checkCompatibility(plugins, targetDCVersion, progressCallback) {
  if (!progressCallback) progressCallback = () => {};

  progressCallback('Launching browser (used only as final fallback)...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const results = [];

  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i];
    progressCallback(`[${i + 1}/${plugins.length}] Processing: ${plugin.name}`);

    let result;
    try {
      const { versions, method } = await fetchAllVersions(browser, plugin, progressCallback);
      result = buildResult(plugin, versions, targetDCVersion, method);
      progressCallback(`  ✓ Found ${result.compatibleVersions.length} compatible versions`);
    } catch (err) {
      progressCallback(`  ✗ Error: ${err.message}`);
      result = {
        pluginName:             plugin.name,
        pluginUrl:              plugin.marketplaceUrl,
        currentVersion:         plugin.currentVersion,
        targetDCVersion,
        fetchMethod:            'failed',
        compatible:             null,
        compatibleVersions:     [],
        compatibleVersionRange: null,
        recommendedVersion:     null,
        error:                  err.message
      };
    }

    results.push(result);
    if (i < plugins.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();
  return results;
}

module.exports = {
  checkCompatibility,
  compareVersions,
  isVersionInRange,
  parseCompatibilityString,
  normalizeVersionHistoryUrl,
  extractAddonIdentifiers
};