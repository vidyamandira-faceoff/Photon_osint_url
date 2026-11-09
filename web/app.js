// Photon Web Frontend Controller

let pollInterval = null;
let timerInterval = null;
let scanStartTime = null;
let logOffset = 0;
let currentStatus = 'idle';
let currentTarget = '';
let currentResults = {};
let activeTab = 'internal';

// DOM Elements
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeToggleText = document.getElementById('themeToggleText');
const crawlForm = document.getElementById('crawlForm');
const targetUrlInput = document.getElementById('targetUrl');
const clearUrlBtn = document.getElementById('clearUrlBtn');
const levelInput = document.getElementById('levelInput');
const levelVal = document.getElementById('levelVal');
const threadsInput = document.getElementById('threadsInput');
const threadsVal = document.getElementById('threadsVal');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const scanTimer = document.getElementById('scanTimer');
const terminalLogs = document.getElementById('terminalLogs');
const terminalWrapper = document.getElementById('terminalWrapper');
const autoScrollToggle = document.getElementById('autoScrollToggle');
const clearTerminalBtn = document.getElementById('clearTerminalBtn');
const scanSelect = document.getElementById('scanSelect');
const resultFilterInput = document.getElementById('resultFilterInput');
const copyTabBtn = document.getElementById('copyTabBtn');
const downloadTabBtn = document.getElementById('downloadTabBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const datasetTabs = document.getElementById('datasetTabs');
const tabListContainer = document.getElementById('tabListContainer');
const dnsMapContainer = document.getElementById('dnsMapContainer');
const dnsMapImage = document.getElementById('dnsMapImage');
const dnsMapDownloadLink = document.getElementById('dnsMapDownloadLink');
const toastEl = document.getElementById('toast');

// Metrics elements
const metricInternal = document.getElementById('metricInternal');
const metricFuzzable = document.getElementById('metricFuzzable');
const metricEndpoints = document.getElementById('metricEndpoints');
const metricKeys = document.getElementById('metricKeys');
const metricIntel = document.getElementById('metricIntel');

// Presets Definition
const PRESETS = {
  quick: { level: 2, threads: 10, keys: false, wayback: false, dns: false, clone: false, delay: 0 },
  deep: { level: 3, threads: 20, keys: true, wayback: true, dns: true, clone: false, delay: 0 },
  keys: { level: 2, threads: 15, keys: true, wayback: true, dns: false, clone: false, delay: 0 },
  stealth: { level: 2, threads: 2, keys: true, wayback: false, dns: false, clone: false, delay: 1.5, timeout: 15 }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  fetchStatus();
  fetchScansList();
});

function initTheme() {
  const saved = localStorage.getItem('photon-theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('photon-theme', theme);
  if (themeToggleText) {
    themeToggleText.textContent = theme === 'dark' ? 'Theme: Light' : 'Theme: Dark';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  showToast(`Switched to ${next.toUpperCase()} mode`);
}

function setupEventListeners() {
  // Theme toggle
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Slider listeners
  levelInput.addEventListener('input', () => { levelVal.textContent = levelInput.value; });
  threadsInput.addEventListener('input', () => { threadsVal.textContent = threadsInput.value; });

  // Clear URL button
  clearUrlBtn.addEventListener('click', () => {
    targetUrlInput.value = '';
    targetUrlInput.focus();
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });

  // Form submit (Start)
  crawlForm.addEventListener('submit', handleStartCrawl);

  // Stop button
  stopBtn.addEventListener('click', handleStopCrawl);

  // Clear Terminal
  clearTerminalBtn.addEventListener('click', () => {
    terminalLogs.innerHTML = '<code><span class="log-dim">[*] Terminal cleared.</span>\n</code>';
    logOffset = 0;
  });

  // Scan Select dropdown
  scanSelect.addEventListener('change', () => {
    if (scanSelect.value) {
      loadResults(scanSelect.value);
    }
  });

  // Tabs switching
  datasetTabs.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tab-btn');
    if (!tabBtn) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    tabBtn.classList.add('active');
    activeTab = tabBtn.dataset.tab;
    renderTabContent();
  });

  // Filter input
  resultFilterInput.addEventListener('input', renderTabContent);

  // Copy Tab
  copyTabBtn.addEventListener('click', copyActiveTab);

  // Download Tab
  downloadTabBtn.addEventListener('click', downloadActiveTab);

  // Export JSON
  exportJsonBtn.addEventListener('click', exportFullJson);
}

function applyPreset(presetName) {
  const cfg = PRESETS[presetName];
  if (!cfg) return;

  levelInput.value = cfg.level;
  levelVal.textContent = cfg.level;

  threadsInput.value = cfg.threads;
  threadsVal.textContent = cfg.threads;

  document.getElementById('toggleKeys').checked = !!cfg.keys;
  document.getElementById('toggleWayback').checked = !!cfg.wayback;
  document.getElementById('toggleDns').checked = !!cfg.dns;
  document.getElementById('toggleClone').checked = !!cfg.clone;

  if (cfg.delay !== undefined) {
    document.getElementById('delayInput').value = cfg.delay;
  }
  if (cfg.timeout !== undefined) {
    document.getElementById('timeoutInput').value = cfg.timeout;
  }

  showToast(`Applied preset: ${presetName.toUpperCase()}`);
}

async function handleStartCrawl(e) {
  e.preventDefault();
  let url = targetUrlInput.value.trim();
  if (!url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    targetUrlInput.value = url;
  }

  const payload = {
    url: url,
    level: parseInt(levelInput.value, 10),
    threads: parseInt(threadsInput.value, 10),
    delay: parseFloat(document.getElementById('delayInput').value || 0),
    timeout: parseFloat(document.getElementById('timeoutInput').value || 10),
    cookie: document.getElementById('cookieInput').value.trim(),
    regex: document.getElementById('regexInput').value.trim(),
    exclude: document.getElementById('excludeInput').value.trim(),
    proxy: document.getElementById('proxyInput').value.trim(),
    seeds: document.getElementById('seedsInput').value.trim(),
    user_agent: document.getElementById('userAgentInput').value.trim(),
    keys: document.getElementById('toggleKeys').checked,
    wayback: document.getElementById('toggleWayback').checked,
    dns: document.getElementById('toggleDns').checked,
    clone: document.getElementById('toggleClone').checked,
    only_urls: document.getElementById('toggleOnlyUrls').checked
  };

  try {
    startBtn.disabled = true;
    startBtn.innerHTML = `<span>Starting...</span>`;

    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
      logOffset = 0;
      terminalLogs.innerHTML = '';
      appendLogLine(`[+] Starting crawl for: ${url}\n`, 'log-green');
      updateStatusUI('running');
      currentTarget = data.target || extractDomain(url);
      startPolling();
      startTimer();
      showToast('Crawl launched successfully!');
    } else {
      showToast(data.error || 'Failed to start scan', true);
      updateStatusUI('idle');
    }
  } catch (err) {
    showToast('Network error starting scan: ' + err.message, true);
    updateStatusUI('idle');
  }
}

async function handleStopCrawl() {
  if (currentStatus !== 'running') return;
  stopBtn.disabled = true;
  stopBtn.innerHTML = `<span>Stopping...</span>`;

  try {
    const res = await fetch('/api/stop', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Crawl stopped');
  } catch (err) {
    showToast('Failed to stop: ' + err.message, true);
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(fetchStatus, 700);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  scanStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    scanTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function fetchStatus() {
  try {
    const res = await fetch(`/api/status?offset=${logOffset}`);
    if (!res.ok) return;
    const data = await res.json();

    updateStatusUI(data.status);

    // Process new logs
    if (data.logs && data.logs.length > 0) {
      appendLogs(data.logs);
      logOffset = data.total_log_count || (logOffset + data.logs.length);
    }

    // Update metrics if target available
    if (data.metrics) {
      updateMetrics(data.metrics);
    }

    // Status transition
    if (data.status !== 'running' && currentStatus === 'running') {
      stopPolling();
      stopTimer();
      showToast(`Scan ${data.status.toUpperCase()}!`);
      fetchScansList();
      if (data.target) {
        loadResults(data.target);
      }
    }

    currentStatus = data.status;
  } catch (err) {
    console.error('Status fetch error:', err);
  }
}

function updateStatusUI(status) {
  currentStatus = status;
  statusIndicator.className = `status-indicator status-${status}`;
  statusText.textContent = status.toUpperCase();

  if (status === 'running') {
    startBtn.disabled = true;
    startBtn.innerHTML = `<span>Crawling...</span>`;
    stopBtn.disabled = false;
    stopBtn.innerHTML = `<span>Stop Crawl</span>`;
  } else {
    startBtn.disabled = false;
    startBtn.innerHTML = `<span>Launch Crawl</span>`;
    stopBtn.disabled = true;
    stopBtn.innerHTML = `<span>Stop Crawl</span>`;
  }
}

function appendLogs(logs) {
  const frag = document.createDocumentFragment();
  for (const line of logs) {
    const span = document.createElement('span');
    span.innerHTML = formatAnsiLog(line) + '\n';
    frag.appendChild(span);
  }
  terminalLogs.appendChild(frag);

  if (autoScrollToggle.checked) {
    terminalWrapper.scrollTop = terminalWrapper.scrollHeight;
  }
}

function appendLogLine(text, className = '') {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  terminalLogs.appendChild(span);
  if (autoScrollToggle.checked) {
    terminalWrapper.scrollTop = terminalWrapper.scrollHeight;
  }
}

function formatAnsiLog(line) {
  // Strip or colorize ANSI escape codes into green, orange, red, yellow
  let cleaned = line
    .replace(/\033\[92m|\033\[32m/g, '<span class="log-green">')
    .replace(/\033\[91m|\033\[31m/g, '<span class="log-red">')
    .replace(/\033\[93m|\033\[33m/g, '<span class="log-yellow">')
    .replace(/\033\[94m|\033\[96m|\033\[36m/g, '<span class="log-orange">')
    .replace(/\033\[95m|\033\[35m/g, '<span class="log-orange">')
    .replace(/\033\[90m|\033\[2m/g, '<span class="log-dim">')
    .replace(/\033\[0m/g, '</span>');

  // Highlight key markers
  cleaned = cleaned.replace(/\[\+\]/g, '<span class="log-green">[+]</span>');
  cleaned = cleaned.replace(/\[\!\]/g, '<span class="log-red">[!]</span>');
  cleaned = cleaned.replace(/\[\*\]/g, '<span class="log-orange">[*]</span>');
  cleaned = cleaned.replace(/\[~\]/g, '<span class="log-yellow">[~]</span>');

  return cleaned;
}

function updateMetrics(metrics) {
  metricInternal.textContent = metrics.internal || 0;
  metricFuzzable.textContent = metrics.fuzzable || 0;
  metricEndpoints.textContent = metrics.endpoints || 0;
  metricKeys.textContent = metrics.keys || 0;
  metricIntel.textContent = metrics.intel || 0;
}

async function fetchScansList() {
  try {
    const res = await fetch('/api/scans');
    if (!res.ok) return;
    const scans = await res.json();

    scanSelect.innerHTML = '';
    if (scans.length === 0) {
      scanSelect.innerHTML = '<option value="">No past scans found</option>';
      return;
    }

    scans.forEach((scan) => {
      const opt = document.createElement('option');
      opt.value = scan.name;
      opt.textContent = `${scan.name} (${scan.count} items, ${scan.time})`;
      scanSelect.appendChild(opt);
    });

    // Auto-select first or current target
    const targetToLoad = currentTarget || scans[0].name;
    scanSelect.value = targetToLoad;
    loadResults(targetToLoad);
  } catch (err) {
    console.error('Error fetching scans list:', err);
  }
}

async function loadResults(target) {
  if (!target) return;
  try {
    const res = await fetch(`/api/results?target=${encodeURIComponent(target)}`);
    if (!res.ok) return;
    currentResults = await res.json();
    currentTarget = target;

    updateTabBadges();
    renderTabContent();

    // Check if DNS image exists
    if (currentResults.has_dns_map) {
      dnsMapImage.src = `/api/dns-image?target=${encodeURIComponent(target)}&t=${Date.now()}`;
      dnsMapDownloadLink.href = dnsMapImage.src;
    }
  } catch (err) {
    console.error('Error loading results:', err);
  }
}

function updateTabBadges() {
  const keys = ['internal', 'fuzzable', 'endpoints', 'keys', 'intel', 'scripts', 'files', 'subdomains', 'robots', 'custom', 'external'];
  keys.forEach(k => {
    const countEl = document.getElementById(`count${capitalize(k)}`);
    if (countEl) {
      const arr = currentResults[k] || [];
      countEl.textContent = arr.length;
    }
  });

  // Also update metric badges
  updateMetrics({
    internal: (currentResults.internal || []).length,
    fuzzable: (currentResults.fuzzable || []).length,
    endpoints: (currentResults.endpoints || []).length,
    keys: (currentResults.keys || []).length,
    intel: (currentResults.intel || []).length
  });
}

function renderTabContent() {
  const query = resultFilterInput.value.toLowerCase().trim();
  const items = currentResults[activeTab] || [];

  // Toggle DNS map view
  if (activeTab === 'subdomains' && currentResults.has_dns_map) {
    dnsMapContainer.style.display = 'flex';
  } else {
    dnsMapContainer.style.display = 'none';
  }

  const filtered = query
    ? items.filter(it => it.toLowerCase().includes(query))
    : items;

  tabListContainer.innerHTML = '';

  if (filtered.length === 0) {
    tabListContainer.innerHTML = `
      <div class="empty-state">
        <p>${items.length === 0 ? `No ${activeTab} data found for ${currentTarget || 'this target'}.` : 'No items match your filter.'}</p>
      </div>
    `;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(item => {
    const div = document.createElement('div');
    div.className = 'result-item';

    const isUrl = item.startsWith('http://') || item.startsWith('https://');
    let textHtml = '';
    if (isUrl) {
      textHtml = `<a href="${escapeHtml(item)}" target="_blank" rel="noopener noreferrer" class="result-text">${escapeHtml(item)}</a>`;
    } else {
      textHtml = `<span class="result-text">${escapeHtml(item)}</span>`;
    }

    div.innerHTML = `
      ${textHtml}
      <div class="result-item-actions">
        <button type="button" class="item-action-btn copy-btn" title="Copy to clipboard">Copy</button>
      </div>
    `;

    div.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(item);
      showToast('Copied to clipboard!');
    });

    frag.appendChild(div);
  });

  tabListContainer.appendChild(frag);
}

function copyActiveTab() {
  const items = currentResults[activeTab] || [];
  if (items.length === 0) {
    showToast('Nothing to copy in this tab');
    return;
  }
  navigator.clipboard.writeText(items.join('\n'));
  showToast(`Copied ${items.length} items from ${activeTab}!`);
}

function downloadActiveTab() {
  const items = currentResults[activeTab] || [];
  if (items.length === 0) {
    showToast('Nothing to download in this tab');
    return;
  }
  const blob = new Blob([items.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentTarget || 'photon'}_${activeTab}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportFullJson() {
  if (!currentResults || Object.keys(currentResults).length === 0) {
    showToast('No results available to export');
    return;
  }
  const blob = new Blob([JSON.stringify(currentResults, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentTarget || 'photon'}_report.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Exported full JSON report!');
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.style.borderColor = isError ? 'var(--accent-red)' : 'var(--accent-green)';
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3200);
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url.replace(/https?:\/\//, '').split('/')[0];
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
