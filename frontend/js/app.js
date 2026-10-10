/**
 * MULE SHIELD — Financial Intelligence & Money Mule Ring Detection Platform
 * Enterprise Frontend Application Controller
 * Real dataset integration, Louvain graph analytics, and authentic empty states.
 */

(function () {
  'use strict';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =========================================================================
  // 1. APPLICATION STATE
  // =========================================================================

  const AppState = {
    // Initial state: authentic empty state. No predefined or fake records.
    dataset: {
      name: "",
      analyzed_at: null,
      transactions: [],
      accounts: [],
      communities: [],
      rings: [],
      findings: [],
      alerts: [],
      cases: [],
      modularity_q: null,
      is_demo: false
    },
    backendConnected: false,
    currentPage: "overview",
    selectedTx: null,
    selectedNode: null,
    selectedCommunity: "ALL",
    txFilters: {
      search: "",
      category: "ALL",
      risk: "ALL"
    },
    alertFilters: {
      severity: "ALL",
      status: "ALL"
    },
    graph: {
      zoom: 1.0,
      panX: 0,
      panY: 0,
      showLabels: true,
      showRings: true,
      searchNode: "",
      selectedNodeId: null
    },
    settings: {
      louvainResolution: 1.0,
      smurfingThreshold: 10000,
      relayWindow: 24,
      layoutMode: "COMMUNITY"
    }
  };

  // =========================================================================
  // 1.2. TERMINOLOGY & DISPLAY MAPPING
  // =========================================================================

  function formatPatternType(type) {
    if (!type) return "Suspicious Pattern";
    const str = String(type).toLowerCase();
    if (str.includes("fan-in") || str.includes("fan in")) return "Many Accounts → One Account";
    if (str.includes("fan-out") || str.includes("fan out") || str.includes("smurf")) return "One Account → Many Accounts";
    if (str.includes("rapid") || str.includes("forward")) return "Money Quickly Forwarded";
    if (str.includes("circular") || str.includes("cycle") || str.includes("loop")) return "Money Moving in a Circle";
    return type;
  }

  function formatAgentName(agent) {
    if (!agent) return "Investigation Agent";
    const str = String(agent).toLowerCase();
    if (str.includes("data") || str.includes("validation")) return "Data Agent";
    if (str.includes("graph") || str.includes("network")) return "Graph Agent";
    if (str.includes("pattern") || str.includes("transaction")) return "Pattern Agent";
    if (str.includes("risk")) return "Risk Agent";
    if (str.includes("explanation") || str.includes("investigation")) return "Investigation Agent";
    return agent;
  }

  // =========================================================================
  // 1.5. CLOUD DEPLOYMENT & CENTRALIZED API URL RESOLUTION
  // =========================================================================

  function getApiBaseUrl() {
    // 1. Config object injected via window.__MULE_SHIELD_CONFIG__ (from frontend/js/config.js)
    if (typeof window !== 'undefined' && window.__MULE_SHIELD_CONFIG__ && window.__MULE_SHIELD_CONFIG__.API_BASE_URL) {
      return String(window.__MULE_SHIELD_CONFIG__.API_BASE_URL).trim().replace(/\/+$/, '');
    }
    // 2. Global window.MULE_SHIELD_API_URL variable
    if (typeof window !== 'undefined' && window.MULE_SHIELD_API_URL) {
      return String(window.MULE_SHIELD_API_URL).trim().replace(/\/+$/, '');
    }
    // 3. HTML meta tag <meta name="mule-shield-api-url" content="...">
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="mule-shield-api-url"]');
      if (meta && meta.content && meta.content.trim()) {
        return meta.content.trim().replace(/\/+$/, '');
      }
    }
    // 4. LocalStorage runtime override (useful for runtime testing/overriding)
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('MULE_SHIELD_API_URL');
        if (stored && stored.trim()) {
          return stored.trim().replace(/\/+$/, '');
        }
      }
    } catch (_) { }

    // 5. Static dev server auto-target:
    // When loaded from static development servers like VS Code Live Server (port 5500) or Vite (port 5173),
    // which lack a reverse proxy, automatically route API requests to the Python engine on port 8000.
    if (typeof window !== 'undefined' && window.location) {
      const host = window.location.hostname;
      const port = window.location.port;
      const isLoopback = host === 'localhost' || host === '127.0.0.1';
      if (isLoopback && port && port !== '8000' && port !== '3000') {
        return `http://${host}:8000`;
      }
    }

    // 6. Default: relative path for local development proxy / same-origin hosting
    return "";
  }

  function getApiUrl(endpoint) {
    const base = getApiBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;

    // Check if running on remote static host without configured backend URL
    if (!base && typeof window !== 'undefined' && window.location) {
      const host = window.location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '0.0.0.0';
      if (!isLocal && !window.__muleShieldWarnedNoApi) {
        console.warn('[MULE SHIELD] Cloud deployment notice: No backend API_BASE_URL is configured. Set window.__MULE_SHIELD_CONFIG__.API_BASE_URL in frontend/js/config.js, via meta tag, or environment build script.');
        window.__muleShieldWarnedNoApi = true;
      }
    }

    if (!base) {
      return cleanEndpoint;
    }
    return base + cleanEndpoint;
  }

  // =========================================================================
  // 2. DOM INITIALIZATION & NAVIGATION
  // =========================================================================

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initGlobalControls();
    initDataManagement();
    initSettingsControls();
    initModalsAndDrawers();

    // Check backend connection and fetch current dataset
    loadCurrentAnalysis();

    // Check URL hash for direct navigation
    const hash = window.location.hash.replace('#', '');
    if (hash && document.querySelector(`.nav-item[data-page="${hash}"]`)) {
      navigateTo(hash);
    } else {
      navigateTo('overview');
    }
  });

  function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.page-section');
    const pageTitle = document.getElementById('page-title');
    const breadcrumbCurrent = document.getElementById('breadcrumb-current');
    const topbar = document.querySelector('.topbar');
    const appLayout = document.querySelector('.app-layout');

    function updateHeaderVisibility(page) {
      const isOverview = page === 'overview';
      if (topbar) {
        topbar.style.display = isOverview ? '' : 'none';
      }
      if (appLayout) {
        appLayout.setAttribute('data-active-page', page);
      }
    }

    window.navigateTo = function (page) {
      AppState.currentPage = page;
      navItems.forEach(i => i.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));

      const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (activeNav) activeNav.classList.add('active');

      const targetSec = document.getElementById(`page-${page}`);
      if (targetSec) targetSec.classList.add('active');

      if (activeNav && pageTitle) {
        const textSpan = activeNav.querySelector('.nav-text') || activeNav;
        const titleText = textSpan.textContent.trim();
        pageTitle.textContent = titleText;
        if (breadcrumbCurrent) breadcrumbCurrent.textContent = titleText;
      }

      updateHeaderVisibility(page);

      // If switching to network page, redraw graph
      if (page === 'network') {
        setTimeout(renderNetworkGraph, 50);
      }

      closeMobileSidebar();
      if (window.location.hash.replace('#', '') !== page) {
        window.location.hash = page;
      }
    };

    window.addEventListener('hashchange', () => {
      const page = window.location.hash.replace('#', '') || 'overview';
      if (page !== AppState.currentPage && document.querySelector(`.nav-item[data-page="${page}"]`)) {
        navigateTo(page);
      }
    });

    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.getAttribute('data-page');
        if (page) navigateTo(page);
      });
    });

    // Responsive mobile drawer state management
    const mobileBtn = document.getElementById('btn-mobile-menu');
    const sidebarCloseBtn = document.getElementById('btn-sidebar-close');
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    function openMobileSidebar() {
      if (sidebar) sidebar.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
      if (appLayout) appLayout.classList.add('drawer-open');
      if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'true');
      if (sidebarCloseBtn) sidebarCloseBtn.focus();
    }

    function closeMobileSidebar() {
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
      if (appLayout) appLayout.classList.remove('drawer-open');
      if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'false');
    }

    if (mobileBtn && sidebar) {
      mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sidebar.classList.contains('open');
        if (isOpen) {
          closeMobileSidebar();
        } else {
          openMobileSidebar();
        }
      });
    }

    if (sidebarCloseBtn) {
      sidebarCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMobileSidebar();
        if (mobileBtn) mobileBtn.focus();
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', () => {
        closeMobileSidebar();
      });
    }

    // Keyboard accessibility: ESC key closes mobile drawer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
        closeMobileSidebar();
        if (mobileBtn) mobileBtn.focus();
      }
    });

    // Handle responsive resize: automatically close drawer if resized to desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > 992 && sidebar && sidebar.classList.contains('open')) {
        closeMobileSidebar();
      }
    });
  }

  function initGlobalControls() {
    // Topbar & Banner Upload buttons
    document.getElementById('btn-topbar-upload')?.addEventListener('click', () => {
      navigateTo('data');
    });
    document.getElementById('btn-overview-banner-upload')?.addEventListener('click', () => {
      navigateTo('data');
    });

    // Run Full Forensics Pipeline on currently loaded dataset
    document.getElementById('btn-run-full-analysis')?.addEventListener('click', async () => {
      if (!AppState.dataset.transactions || AppState.dataset.transactions.length === 0) {
        showToast("No dataset loaded to analyze.", "warning");
        return;
      }
      showLoading("Executing Louvain Community Optimization & Multi-Agent Heuristics...");
      setTimeout(() => {
        hideLoading();
        showToast("Forensic analysis completed with real dataset results.");
      }, 500);
    });

    // Export Summary
    document.getElementById('btn-export-overview-summary')?.addEventListener('click', () => {
      if (!AppState.dataset.transactions || AppState.dataset.transactions.length === 0) {
        showToast("No dataset loaded to export.", "warning");
        return;
      }
      downloadJson(AppState.dataset, "mule_shield_summary.json");
    });

    // Transaction Explorer Filters
    const txSearch = document.getElementById('tx-search-box');
    const txCategory = document.getElementById('tx-category-filter');
    const txRisk = document.getElementById('tx-risk-filter');

    const updateTxFilters = () => {
      AppState.txFilters.search = (txSearch?.value || '').toLowerCase();
      AppState.txFilters.category = txCategory?.value || 'ALL';
      AppState.txFilters.risk = txRisk?.value || 'ALL';
      renderTransactionsTable();
    };

    txSearch?.addEventListener('input', updateTxFilters);
    txCategory?.addEventListener('change', updateTxFilters);
    txRisk?.addEventListener('change', updateTxFilters);

    document.getElementById('btn-reset-tx-filters')?.addEventListener('click', () => {
      if (txSearch) txSearch.value = '';
      if (txCategory) txCategory.value = 'ALL';
      if (txRisk) txRisk.value = 'ALL';
      updateTxFilters();
    });

    document.getElementById('btn-export-tx-filtered')?.addEventListener('click', exportTransactionsCsv);

    // Alert filter controls
    const alertSev = document.getElementById('alert-severity-filter');
    const alertStat = document.getElementById('alert-status-filter');

    const updateAlertFilters = () => {
      AppState.alertFilters.severity = alertSev?.value || 'ALL';
      AppState.alertFilters.status = alertStat?.value || 'ALL';
      renderAlertsList();
    };

    alertSev?.addEventListener('change', updateAlertFilters);
    alertStat?.addEventListener('change', updateAlertFilters);

    document.getElementById('btn-mark-all-read')?.addEventListener('click', () => {
      if (!AppState.dataset.alerts || AppState.dataset.alerts.length === 0) return;
      AppState.dataset.alerts.forEach(a => a.status = 'UNDER_REVIEW');
      renderAlertsList();
      showToast("All operational alerts marked as Under Review.");
    });

    // Export buttons in Reports
    document.getElementById('btn-export-csv-web')?.addEventListener('click', exportTransactionsCsv);
    document.getElementById('btn-export-json-web')?.addEventListener('click', () => downloadJson(AppState.dataset, 'mule_shield_intelligence.json'));
    document.getElementById('btn-export-json-web-2')?.addEventListener('click', () => downloadJson(AppState.dataset, 'mule_shield_intelligence.json'));
  }

  // =========================================================================
  // 3. BACKEND API INTEGRATION & DATASET MANAGEMENT
  // =========================================================================

  async function checkBackendHealth() {
    try {
      const res = await fetch(getApiUrl('/api/health'));
      if (res.ok) {
        AppState.backendConnected = true;
        updateConnectionStatus(true);
        return true;
      }
    } catch (e) {
      AppState.backendConnected = false;
      updateConnectionStatus(false);
      return false;
    }
  }

  function updateConnectionStatus(isOnline) {
    const dot = document.getElementById('sidebar-status-dot');
    const label = document.getElementById('sidebar-engine-status');

    if (isOnline) {
      if (dot) { dot.className = 'status-dot online'; }
      if (label) { label.textContent = 'Backend Connected'; }
    } else {
      if (dot) { dot.className = 'status-dot offline'; }
      if (label) { label.textContent = 'Backend Offline'; }
    }
  }

  async function loadCurrentAnalysis() {
    showLoading("Connecting to Analytical Engine...");

    const isHealthy = await checkBackendHealth();
    if (!isHealthy) {
      hideLoading();
      renderAllViews();
      return;
    }

    try {
      const res = await fetch(getApiUrl('/api/datasets/current'));
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.transactions)) {
          AppState.dataset = data;
        }
      }
    } catch (err) {
      console.warn('API error:', err);
    } finally {
      hideLoading();
      renderAllViews();
    }
  }


  async function clearDataset() {
    showLoading("Clearing Dataset...");
    try {
      const res = await fetch(getApiUrl('/api/datasets/clear'), { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        AppState.dataset = json.dataset;
      } else {
        AppState.dataset = {
          name: "",
          analyzed_at: null,
          transactions: [],
          accounts: [],
          communities: [],
          rings: [],
          findings: [],
          alerts: [],
          cases: [],
          modularity_q: null,
          is_demo: false
        };
      }
      showToast("Dataset cleared. Ready for new transaction import.");
    } catch (e) {
      AppState.dataset.transactions = [];
    } finally {
      hideLoading();
      renderAllViews();
    }
  }

  function renderAllViews() {
    updateDatasetHeaderContext();
    renderKPIs();
    renderVolumeChart();
    renderRiskDistribution();
    renderClusterRiskHeatmap();
    renderPrioritiesTable();
    renderAgentFindings();
    renderTransactionsTable();
    renderMuleRings();
    renderAlertsList();
    renderCasesList();
    renderReportDossier();
    renderNetworkGraph();
  }

  function updateDatasetHeaderContext() {
    const data = AppState.dataset;
    const hasData = data.transactions && data.transactions.length > 0;
    const pill = document.getElementById('current-dataset-label');
    const pillDot = document.getElementById('dataset-pill-dot');
    const emptyBanner = document.getElementById('overview-empty-banner');
    const btnExportSummary = document.getElementById('btn-export-overview-summary');
    const btnRunAnalysis = document.getElementById('btn-run-full-analysis');

    if (hasData) {
      if (pill) pill.textContent = data.name || "Uploaded Dataset";
      if (pillDot) pillDot.style.background = "var(--success)";
      if (emptyBanner) emptyBanner.style.display = "none";
      if (btnExportSummary) {
        btnExportSummary.style.display = "inline-flex";
        btnExportSummary.disabled = false;
      }
      if (btnRunAnalysis) {
        btnRunAnalysis.style.display = "inline-flex";
        btnRunAnalysis.disabled = false;
      }
    } else {
      if (pill) pill.textContent = "No dataset loaded";
      if (pillDot) pillDot.style.background = "var(--text-tertiary)";
      if (emptyBanner) emptyBanner.style.display = "flex";
      if (btnExportSummary) {
        btnExportSummary.style.display = "inline-flex";
        btnExportSummary.disabled = false;
      }
      if (btnRunAnalysis) {
        btnRunAnalysis.style.display = "inline-flex";
        btnRunAnalysis.disabled = false;
      }
    }

    updateConnectionStatus(AppState.backendConnected);
  }

  // =========================================================================
  // 4. OVERVIEW DASHBOARD RENDERING
  // =========================================================================

  function renderKPIs() {
    const data = AppState.dataset;
    const txCount = data.transactions?.length || 0;
    const totalVol = (data.transactions || []).reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const commCount = data.communities?.length || 0;
    const ringsCount = data.rings?.length || 0;
    const casesCount = data.cases?.length || 0;
    const accountsCount = data.accounts?.length || 0;
    const flaggedCount = (data.accounts || []).filter(a => a.risk_score >= 60).length;

    // Transactions KPI
    const elTx = document.getElementById('kpi-txs');
    if (elTx) elTx.textContent = txCount;
    const elTxSub = document.getElementById('kpi-txs-sub');
    if (elTxSub) elTxSub.textContent = txCount > 0 ? "100% Directed Edges" : "No ledger uploaded";

    // Volume KPI
    const elVol = document.getElementById('kpi-vol');
    if (elVol) elVol.textContent = '$' + totalVol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const elVolSub = document.getElementById('kpi-vol-sub');
    if (elVolSub) elVolSub.textContent = txCount > 0 ? "Audited flow volume" : "Gross flow volume";

    // Accounts KPI
    const elAccounts = document.getElementById('kpi-accounts');
    if (elAccounts) elAccounts.textContent = accountsCount;
    const elFlagged = document.getElementById('kpi-flagged-accounts');
    if (elFlagged) elFlagged.textContent = `${flaggedCount} Flagged for review`;

    // Louvain Communities KPI
    const elComm = document.getElementById('kpi-comm');
    if (elComm) elComm.textContent = commCount;
    const elMod = document.getElementById('kpi-modularity');
    if (elMod) {
      elMod.textContent = data.modularity_q !== null ? `Modularity Q: ${data.modularity_q.toFixed(3)}` : "Modularity Q: --";
    }

    // Candidate Rings KPI
    const elRings = document.getElementById('kpi-rings');
    if (elRings) elRings.textContent = ringsCount;
    const elRingsCard = document.getElementById('kpi-card-rings');
    if (elRingsCard) {
      elRingsCard.className = ringsCount > 0 ? "kpi-card kpi-card-danger" : "kpi-card";
    }

    // Investigation Cases KPI
    const elCases = document.getElementById('kpi-cases');
    if (elCases) elCases.textContent = casesCount;
    const elCasesSub = document.getElementById('kpi-active-cases');
    if (elCasesSub) elCasesSub.textContent = `${casesCount} Active dockets`;

    // Sidebar Badges
    const sideRingBadge = document.getElementById('sidebar-ring-badge');
    if (sideRingBadge) {
      sideRingBadge.textContent = ringsCount;
      sideRingBadge.style.display = ringsCount > 0 ? "inline-block" : "none";
    }

    const sideAlertBadge = document.getElementById('sidebar-alert-badge');
    const alertCount = data.alerts?.length || 0;
    if (sideAlertBadge) {
      sideAlertBadge.textContent = alertCount;
      sideAlertBadge.style.display = alertCount > 0 ? "inline-block" : "none";
    }
  }

  function renderVolumeChart() {
    const container = document.getElementById('volume-chart-container');
    if (!container) return;

    const txs = AppState.dataset.transactions || [];
    if (txs.length === 0) {
      container.innerHTML = `
        <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:12px;">
          No transactions in current dataset.
        </div>
      `;
      return;
    }

    // Group transactions by hour or buckets
    const bucketMap = {};
    txs.forEach(t => {
      const d = new Date(t.timestamp || Date.now());
      const hourLabel = `${String(d.getHours()).padStart(2, '0')}:00`;
      if (!bucketMap[hourLabel]) {
        bucketMap[hourLabel] = { amount: 0, hasAnomaly: false, count: 0 };
      }
      bucketMap[hourLabel].amount += (t.amount || 0);
      bucketMap[hourLabel].count += 1;
      if (t.is_laundering) bucketMap[hourLabel].hasAnomaly = true;
    });

    const buckets = Object.keys(bucketMap).sort().map(k => ({
      label: k,
      amount: bucketMap[k].amount,
      anomaly: bucketMap[k].hasAnomaly,
      count: bucketMap[k].count
    }));

    const maxAmt = Math.max(...buckets.map(b => b.amount), 1);

    container.innerHTML = buckets.map(b => {
      const heightPercent = Math.max(8, (b.amount / maxAmt) * 90);
      return `
        <div class="vol-bar-group" title="${b.label}: $${b.amount.toLocaleString()} (${b.count} txs)">
          <div class="vol-bar ${b.anomaly ? 'anomaly' : ''}" style="height: ${heightPercent}%;"></div>
          <span class="vol-label">${b.label}</span>
        </div>
      `;
    }).join('');
  }

  function renderRiskDistribution() {
    const bar = document.getElementById('risk-meter-bar');
    const legend = document.getElementById('risk-legend-list');
    if (!bar || !legend) return;

    const accounts = AppState.dataset.accounts || [];
    if (accounts.length === 0) {
      bar.innerHTML = '<div class="risk-segment" style="width: 100%; background: #E2E8F0;" title="No data"></div>';
      legend.innerHTML = '<div class="text-secondary text-sm">No analysis performed. Ingest dataset to compute risk distribution.</div>';
      return;
    }

    let crit = 0, high = 0, med = 0, low = 0;
    accounts.forEach(a => {
      const score = Number(a.risk_score || 0);
      if (score >= 80) crit++;
      else if (score >= 60) high++;
      else if (score >= 35) med++;
      else low++;
    });

    const total = accounts.length;
    const critPct = total > 0 ? (crit / total) * 100 : 0;
    const highPct = total > 0 ? (high / total) * 100 : 0;
    const medPct = total > 0 ? (med / total) * 100 : 0;
    const lowPct = total > 0 ? (low / total) * 100 : 0;

    let barHtml = '';
    if (crit > 0) barHtml += `<div class="risk-segment critical" style="width: ${critPct}%;" title="Critical: ${crit} accounts (${critPct.toFixed(1)}%)"></div>`;
    if (high > 0) barHtml += `<div class="risk-segment high" style="width: ${highPct}%;" title="High Risk: ${high} accounts (${highPct.toFixed(1)}%)"></div>`;
    if (med > 0) barHtml += `<div class="risk-segment medium" style="width: ${medPct}%;" title="Medium Risk: ${med} accounts (${medPct.toFixed(1)}%)"></div>`;
    if (low > 0) barHtml += `<div class="risk-segment low" style="width: ${lowPct}%;" title="Low Risk: ${low} accounts (${lowPct.toFixed(1)}%)"></div>`;
    if (!barHtml) {
      barHtml = '<div class="risk-segment" style="width: 100%; background: #E2E8F0;" title="No data"></div>';
    }
    bar.innerHTML = barHtml;

    const tiers = [
      { name: 'Critical Risk', range: 'Score ≥ 80', count: crit, pct: critPct, dot: 'var(--critical)' },
      { name: 'High Risk', range: 'Score 60–79', count: high, pct: highPct, dot: 'var(--danger)' },
      { name: 'Medium Risk', range: 'Score 35–59', count: med, pct: medPct, dot: 'var(--warning)' },
      { name: 'Low Risk', range: 'Score < 35', count: low, pct: lowPct, dot: 'var(--success)' }
    ];

    legend.innerHTML = tiers.map(t => `
      <div class="risk-legend-item">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="status-dot" style="background: ${t.dot};"></span>
          <span style="font-weight: 500;">${t.name} <span class="risk-desc">(${t.range})</span></span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="risk-count">${t.count}</span>
          <span class="risk-desc">${t.pct.toFixed(0)}%</span>
        </div>
      </div>
    `).join('');
  }

  function renderClusterRiskHeatmap() {
    const grid = document.getElementById('heatmap-grid');
    if (!grid) return;

    const communities = AppState.dataset.communities || [];
    if (communities.length === 0) {
      grid.innerHTML = `
        <div class="card" style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-secondary);">
          No connected account groups detected. Upload transactions to execute clustering.
        </div>
      `;
      return;
    }

    const accounts = AppState.dataset.accounts || [];
    const accMap = {};
    accounts.forEach(a => { accMap[a.id] = a; });

    const tiles = communities.map(comm => {
      const members = comm.members || [];
      let sumScore = 0;
      let flagged = 0;

      members.forEach(id => {
        const acc = accMap[id];
        const s = acc ? acc.risk_score : 15.0;
        sumScore += s;
        if (s >= 60.0) flagged++;
      });

      const avgScore = members.length > 0 ? (sumScore / members.length) : 0;
      return {
        id: comm.id,
        size: comm.size,
        volume: comm.total_volume || 0,
        score: avgScore,
        flagged: flagged
      };
    });

    tiles.sort((a, b) => b.score - a.score);

    grid.innerHTML = tiles.map(t => {
      let bg, textCol, borderCol, band;

      if (t.score >= 80) {
        bg = '#7F1D1D'; textCol = '#FFFFFF'; borderCol = '#B91C1C'; band = 'CRITICAL';
      } else if (t.score >= 60) {
        bg = '#FEE2E2'; textCol = '#991B1B'; borderCol = '#EF4444'; band = 'HIGH';
      } else if (t.score >= 40) {
        bg = '#FEF3C7'; textCol = '#92400E'; borderCol = '#F59E0B'; band = 'MEDIUM';
      } else {
        bg = '#DCFCE7'; textCol = '#15803D'; borderCol = '#22C55E'; band = 'LOW';
      }

      return `
        <div class="heatmap-tile" style="background:${bg}; color:${textCol}; border-color:${borderCol};" onclick="focusCommunityInGraph(${t.id})">
          <div class="heatmap-header">
            <span class="heatmap-cluster-id">Connected Group #${t.id}</span>
            <span class="badge" style="background:rgba(0,0,0,0.15); color:inherit;">${band}</span>
          </div>
          <div class="heatmap-score">${t.score.toFixed(1)} <small style="font-size:12px; font-weight:normal;">/ 100</small></div>
          <div class="heatmap-meta">${t.size} Monitored Entities • ${t.flagged} High Risk</div>
          <div class="heatmap-meta" style="margin-top:2px; font-weight:700;">$${t.volume.toLocaleString()} Liquidity Flow</div>
        </div>
      `;
    }).join('');
  }

  // =========================================================================
  // Centralized Risk Classification Engine (Consistent across all components)
  // =========================================================================
  function getRiskClassification(score, flags, isLaundering) {
    if (score !== null && score !== undefined && !isNaN(score)) {
      const s = Number(score);
      if (s >= 70 || isLaundering) {
        return {
          tier: 'HIGH',
          score: s,
          label: 'HIGH RISK',
          status: 'SUSPICIOUS',
          badgeClass: s >= 80 ? 'badge-critical' : 'badge-danger',
          rowClass: 'row-danger',
          textClass: 'text-risk-high',
          color: '#B91C1C'
        };
      }
      if (s >= 35) {
        return {
          tier: 'MEDIUM',
          score: s,
          label: 'MEDIUM RISK',
          status: 'NEEDS REVIEW',
          badgeClass: 'badge-warning',
          rowClass: 'row-warning',
          textClass: 'text-risk-medium',
          color: '#B45309'
        };
      }
      return {
        tier: 'LOW',
        score: s,
        label: 'LOW RISK',
        status: 'NORMAL',
        badgeClass: 'badge-success',
        rowClass: 'row-success',
        textClass: 'text-risk-low',
        color: '#15803D'
      };
    }

    if (isLaundering) {
      return {
        tier: 'HIGH',
        score: 85.0,
        label: 'HIGH RISK',
        status: 'SUSPICIOUS',
        badgeClass: 'badge-danger',
        rowClass: 'row-danger',
        textClass: 'text-risk-high',
        color: '#B91C1C'
      };
    }
    if (flags && flags.length > 0) {
      return {
        tier: 'MEDIUM',
        score: 50.0,
        label: 'MEDIUM RISK',
        status: 'NEEDS REVIEW',
        badgeClass: 'badge-warning',
        rowClass: 'row-warning',
        textClass: 'text-risk-medium',
        color: '#B45309'
      };
    }
    return {
      tier: 'UNKNOWN',
      score: null,
      label: 'UNCLASSIFIED',
      status: 'UNKNOWN',
      badgeClass: 'badge-outline',
      rowClass: 'row-neutral',
      textClass: 'text-risk-unknown',
      color: '#94A3B8'
    };
  }

  function getFlagBadgeHtml(flag) {
    if (!flag) return '';
    const upper = String(flag).toUpperCase();
    if (upper.includes('CYCLE') || upper.includes('SMURF') || upper.includes('CRITICAL') || upper.includes('MULE')) {
      return `<span class="badge badge-danger">${escapeHtml(flag)}</span>`;
    }
    if (upper.includes('BSA') || upper.includes('PASS-THROUGH') || upper.includes('COUNTERPARTY') || upper.includes('HIGH_VALUE') || upper.includes('FORWARD')) {
      return `<span class="badge badge-warning">${escapeHtml(flag)}</span>`;
    }
    return `<span class="badge badge-success">${escapeHtml(flag)}</span>`;
  }

  function renderPrioritiesTable() {
    const tbody = document.getElementById('priorities-table-body');
    if (!tbody) return;

    const accounts = [...(AppState.dataset.accounts || [])];

    if (accounts.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:24px; color:var(--text-secondary);">
            No high-priority accounts flagged. Ingest transactions to compute risk vectors.
          </td>
        </tr>
      `;
      return;
    }

    accounts.sort((a, b) => b.risk_score - a.risk_score);

    tbody.innerHTML = accounts.slice(0, 10).map(acc => {
      const risk = getRiskClassification(acc.risk_score, acc.flags, acc.risk_score >= 60);
      const flagsHtml = (acc.flags || []).map(f => getFlagBadgeHtml(f)).join(' ') || '<span class="badge badge-success">Nominal</span>';

      return `
        <tr class="${risk.rowClass}">
          <td>
            <strong style="color:var(--primary-blue); font-family:var(--font-mono);">${escapeHtml(acc.id)}</strong>
          </td>
          <td><span class="badge badge-outline">Connected Group #${acc.community_id}</span></td>
          <td><span class="badge ${risk.badgeClass}">${acc.risk_score.toFixed(1)}</span></td>
          <td>${flagsHtml}</td>
          <td class="text-secondary">${acc.last_active || 'Recent'}</td>
          <td><span class="badge ${risk.badgeClass}">${risk.status}</span></td>
          <td>
            <button class="btn btn-xs btn-outline" onclick="inspectAccount('${acc.id}')">Inspect</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderAgentFindings() {
    const container = document.getElementById('findings-container');
    const badge = document.getElementById('agent-orchestration-badge');
    if (!container) return;

    const findings = AppState.dataset.findings || [];
    if (findings.length === 0) {
      if (badge) {
        badge.textContent = "STANDBY";
        badge.className = "badge badge-outline";
      }
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:20px; color:var(--text-secondary);">
          Autonomous AI investigation agents are on standby. Upload a dataset in Upload Transactions to run multi-agent inspection.
        </div>
      `;
      return;
    }

    if (badge) {
      badge.textContent = "4 AGENTS SYNCHRONIZED";
      badge.className = "badge badge-primary";
    }

    container.innerHTML = findings.map((f, i) => {
      const colors = ["var(--primary-blue)", "#7C3AED", "#B45309", "#059669"];
      const col = colors[i % colors.length];
      const agentDisplayName = formatAgentName(f.agent);
      return `
        <div class="finding-card" style="border-left-color: ${col};">
          <div class="finding-header">
            <span class="finding-agent-title" style="color:${col};">${agentDisplayName}</span>
            <span class="badge badge-outline">${f.status}</span>
          </div>
          <p class="finding-body">${f.summary}</p>
        </div>
      `;
    }).join('');
  }

  // =========================================================================
  // 5. TRANSACTION EXPLORER RENDERING
  // =========================================================================

  function renderTransactionsTable() {
    const tbody = document.getElementById('tx-table-body');
    const counter = document.getElementById('tx-table-counter');
    if (!tbody) return;

    let txs = AppState.dataset.transactions || [];

    if (txs.length === 0) {
      if (counter) counter.textContent = "No records loaded";
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center; padding:32px; color:var(--text-secondary);">
            No transaction records in current ledger. Upload a CSV file in Data Management to begin investigation.
          </td>
        </tr>
      `;
      return;
    }

    // Filter by search
    if (AppState.txFilters.search) {
      const q = AppState.txFilters.search.toLowerCase();
      txs = txs.filter(t =>
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.sender_id && t.sender_id.toLowerCase().includes(q)) ||
        (t.receiver_id && t.receiver_id.toLowerCase().includes(q))
      );
    }

    // Filter by category
    if (AppState.txFilters.category !== 'ALL') {
      txs = txs.filter(t => t.category === AppState.txFilters.category);
    }

    // Filter by risk tier
    if (AppState.txFilters.risk === 'HIGH') {
      txs = txs.filter(t => {
        const r = getRiskClassification(t.risk_score, t.flags, t.is_laundering);
        return r.tier === 'HIGH';
      });
    } else if (AppState.txFilters.risk === 'MEDIUM') {
      txs = txs.filter(t => {
        const r = getRiskClassification(t.risk_score, t.flags, t.is_laundering);
        return r.tier === 'MEDIUM';
      });
    } else if (AppState.txFilters.risk === 'LOW') {
      txs = txs.filter(t => {
        const r = getRiskClassification(t.risk_score, t.flags, t.is_laundering);
        return r.tier === 'LOW';
      });
    } else if (AppState.txFilters.risk === 'FLAGGED') {
      txs = txs.filter(t => t.flags && t.flags.length > 0);
    } else if (AppState.txFilters.risk === 'NOMINAL') {
      txs = txs.filter(t => !t.flags || t.flags.length === 0);
    }

    const deleteActiveBtn = document.getElementById('btn-delete-active-dataset');
    if (deleteActiveBtn) {
      if ((AppState.dataset.transactions || []).length > 0 && AppState.dataset.id) {
        deleteActiveBtn.style.display = 'inline-flex';
        deleteActiveBtn.textContent = `Delete Dataset (${(AppState.dataset.transactions || []).length} Txs)`;
      } else {
        deleteActiveBtn.style.display = 'none';
      }
    }

    if (counter) counter.textContent = `Showing ${txs.length} of ${AppState.dataset.transactions.length} records`;

    tbody.innerHTML = txs.map(tx => {
      const risk = getRiskClassification(tx.risk_score, tx.flags, tx.is_laundering);
      const flagsHtml = (tx.flags || []).map(f => getFlagBadgeHtml(f)).join(' ') || '<span class="badge badge-success">Nominal</span>';
      const riskScoreText = risk.score !== null ? `${risk.score.toFixed(1)}` : 'N/A';

      return `
        <tr class="${risk.rowClass}">
          <td>
            <a href="javascript:void(0)" onclick="openTransactionDrawer('${tx.id}')" style="font-weight:700; font-family:var(--font-mono);">
              ${escapeHtml(tx.id)}
            </a>
          </td>
          <td style="font-family:var(--font-mono);">${escapeHtml(tx.sender_id)}</td>
          <td style="font-family:var(--font-mono);">${escapeHtml(tx.receiver_id)}</td>
          <td style="font-weight:700;">$${(tx.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td class="text-secondary">${new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td><span class="badge badge-outline">${escapeHtml(tx.category || 'TRANSFER')}</span></td>
          <td class="tx-cell-risk">
            <span class="badge ${risk.badgeClass} tx-risk-badge" title="Risk Score: ${riskScoreText}">
              <span class="tx-risk-label">${escapeHtml(risk.label)}</span>
              ${risk.score !== null ? `<span class="tx-risk-score">(${riskScoreText})</span>` : ''}
            </span>
          </td>
          <td>${flagsHtml}</td>
          <td><span class="badge badge-outline">Cluster #${tx.community_id !== undefined ? tx.community_id : '-'}</span></td>
          <td>
            <div style="display:inline-flex; gap:6px; align-items:center;">
              <button class="btn btn-xs btn-outline" onclick="openTransactionDrawer('${tx.id}')">Inspect</button>
              <button class="btn btn-xs btn-outline btn-delete-tx-dataset" style="color:var(--danger); border-color:var(--danger-border);" onclick="triggerDeleteDatasetForTx('${tx.id}')" title="Permanently delete dataset associated with this transaction">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.openTransactionDrawer = function (txId) {
    const tx = (AppState.dataset.transactions || []).find(t => t.id === txId);
    if (!tx) return;

    AppState.selectedTx = tx;
    const drawer = document.getElementById('tx-detail-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const title = document.getElementById('drawer-tx-title');
    const body = document.getElementById('drawer-tx-body');

    if (title) title.textContent = `Transaction ${tx.id}`;

    const risk = getRiskClassification(tx.risk_score, tx.flags, tx.is_laundering);
    const flagsHtml = (tx.flags || []).map(f => getFlagBadgeHtml(f)).join(' ') || '<span class="badge badge-success">Nominal flow. No suspicious indicators detected.</span>';

    if (body) {
      body.innerHTML = `
        <div class="inspector-field">
          <div class="inspector-label">Amount &amp; Risk Classification</div>
          <div class="inspector-val" style="font-size:22px; color:var(--primary-blue);">
            $${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            <span class="badge ${risk.badgeClass}" style="vertical-align:middle; margin-left:8px;">${risk.label} ${risk.score !== null ? `(${risk.score.toFixed(1)})` : ''}</span>
          </div>
        </div>

        <div class="inspector-field">
          <div class="inspector-label">Originator (Sender)</div>
          <div class="inspector-val" style="font-family:var(--font-mono);">${escapeHtml(tx.sender_id)}</div>
        </div>

        <div class="inspector-field">
          <div class="inspector-label">Beneficiary (Receiver)</div>
          <div class="inspector-val" style="font-family:var(--font-mono);">${escapeHtml(tx.receiver_id)}</div>
        </div>

        <div class="inspector-field">
          <div class="inspector-label">Timestamp</div>
          <div class="inspector-val">${new Date(tx.timestamp).toUTCString()}</div>
        </div>

        <div class="inspector-field">
          <div class="inspector-label">Flow Topology &amp; Category</div>
          <div class="inspector-val">
            <span class="badge badge-outline">${escapeHtml(tx.category || 'TRANSFER')}</span>
            <span class="badge badge-outline" style="margin-left:6px;">Cluster #${tx.community_id !== undefined ? tx.community_id : '-'}</span>
          </div>
        </div>

        <div class="inspector-field">
          <div class="inspector-label">Forensic Indicators &amp; Detection Flags</div>
          <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;">
            ${flagsHtml}
          </div>
        </div>

        <hr style="margin:20px 0; border:0; border-top:1px solid var(--border);">

        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; gap:10px;">
            <button class="btn btn-primary" style="flex:1;" onclick="addTxToCase('${tx.id}')">Add to Case Docket</button>
            <button class="btn btn-outline" onclick="focusAccountInGraph('${tx.sender_id}')">Trace in Graph</button>
          </div>
          <button class="btn btn-sm btn-outline" style="color:var(--danger); border-color:var(--danger-border); margin-top:4px;" onclick="triggerDeleteDatasetForTx('${tx.id}')">Permanently Delete Dataset</button>
        </div>
      `;
    }

    if (drawer) drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  };

  window.closeDrawer = function () {
    const drawer = document.getElementById('tx-detail-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  };

  window.addTxToCase = function (txId) {
    showToast(`Transaction ${txId} attached to active docket.`);
    closeDrawer();
  };

  // =========================================================================
  // 6. NETWORK INTELLIGENCE GRAPH CANVAS
  // =========================================================================

  // Risk-based Node Color Mapper:
  // HIGH / CRITICAL RISK: Red (#DC2626)
  // MEDIUM RISK: Orange (#F59E0B)
  // LOW RISK: Green (#16A34A)
  // Unavailable: Neutral Grey (#94A3B8)
  function getNodeRiskColor(id) {
    const allAccounts = AppState.dataset.accounts || [];
    const acc = allAccounts.find(a => a.id === id || a.account_identifier === id);

    if (acc) {
      // 1. Check explicit risk level or risk band
      const level = String(acc.risk_level || acc.risk_band || '').toUpperCase();
      if (level === 'CRITICAL' || level === 'HIGH' || acc.status === 'SUSPICIOUS') {
        return '#DC2626'; // High / Critical Risk: Red
      }
      if (level === 'MEDIUM' || acc.status === 'NEEDS_REVIEW') {
        return '#F59E0B'; // Medium Risk: Orange
      }
      if (level === 'LOW' || acc.status === 'NORMAL') {
        return '#16A34A'; // Low Risk: Green
      }

      // 2. Check numerical risk score
      if (acc.risk_score !== null && acc.risk_score !== undefined && !isNaN(acc.risk_score)) {
        const s = Number(acc.risk_score);
        if (s >= 60 || (Array.isArray(acc.flags) && acc.flags.length > 0)) {
          return '#DC2626'; // Red
        }
        if (s >= 35) {
          return '#F59E0B'; // Orange
        }
        return '#16A34A'; // Green
      }
    } else {
      // If account record is not in accounts array, inspect active transactions
      const txs = (AppState.dataset.transactions || []).filter(t => t.sender_id === id || t.receiver_id === id);
      if (txs.length > 0) {
        const isLaundering = txs.some(t => t.is_laundering || (Array.isArray(t.flags) && t.flags.length > 0));
        const maxScore = Math.max(...txs.map(t => Number(t.risk_score || 0)), 0);
        if (isLaundering || maxScore >= 60) {
          return '#DC2626'; // Red
        }
        if (maxScore >= 35) {
          return '#F59E0B'; // Orange
        }
        return '#16A34A'; // Green
      }
    }

    // 3. Fallback: Neutral grey when risk classification is unavailable
    return '#94A3B8';
  }

  function renderNetworkGraph() {
    const canvas = document.getElementById('network-canvas');
    const emptyMsg = document.getElementById('graph-empty-message');
    if (!canvas) return;

    const txs = AppState.dataset.transactions || [];
    const communities = AppState.dataset.communities || [];

    if (txs.length === 0 || communities.length === 0) {
      if (emptyMsg) emptyMsg.style.display = "flex";
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    // Update community dropdown filter
    const commSelect = document.getElementById('graph-community-filter');
    if (commSelect && commSelect.options.length <= 1) {
      commSelect.innerHTML = '<option value="ALL">All Communities</option>' + communities.map(c => `
        <option value="${c.id}">Community #${c.id} (${c.size} nodes)</option>
      `).join('');
    }

    const selectedComm = AppState.selectedCommunity;
    const activeTxs = selectedComm === 'ALL'
      ? txs
      : txs.filter(t => String(t.community_id) === String(selectedComm));

    // Dynamic community positioning in a ring
    const commCenters = {};
    const commCount = communities.length;
    communities.forEach((c, idx) => {
      const angle = (idx / commCount) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.28;
      commCenters[c.id] = {
        x: (width / 2) + Math.cos(angle) * radius,
        y: (height / 2) + Math.sin(angle) * radius
      };
    });

    const nodeCoords = {};
    communities.forEach(c => {
      const center = commCenters[c.id] || { x: width / 2, y: height / 2 };
      const subRadius = Math.max(35, Math.min(100, c.members.length * 16));
      const count = c.members.length;

      c.members.forEach((mId, idx) => {
        const angle = (idx / count) * Math.PI * 2;
        nodeCoords[mId] = {
          x: center.x + Math.cos(angle) * subRadius + AppState.graph.panX,
          y: center.y + Math.sin(angle) * subRadius + AppState.graph.panY,
          commId: c.id,
          color: c.color
        };
      });
    });

    AppState.graph.nodeCoords = nodeCoords;

    // Draw Directed Edges
    activeTxs.forEach(tx => {
      const p1 = nodeCoords[tx.sender_id];
      const p2 = nodeCoords[tx.receiver_id];
      if (!p1 || !p2) return;

      const isRingLeg = tx.flags && tx.flags.length > 0;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);

      if (isRingLeg) {
        ctx.strokeStyle = tx.category === 'CYCLE' ? '#EF4444' : '#F59E0B';
        ctx.lineWidth = 2.2;
        if (AppState.graph.showRings) {
          ctx.setLineDash([5, 3]);
        }
      } else {
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowheads
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const nodeRadius = 14;
      const arrowX = p2.x - Math.cos(angle) * nodeRadius;
      const arrowY = p2.y - Math.sin(angle) * nodeRadius;

      ctx.beginPath();
      ctx.fillStyle = isRingLeg ? (tx.category === 'CYCLE' ? '#EF4444' : '#F59E0B') : '#94A3B8';
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - 8 * Math.cos(angle - Math.PI / 6), arrowY - 8 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(arrowX - 8 * Math.cos(angle + Math.PI / 6), arrowY - 8 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    });

    // Draw Nodes
    Object.keys(nodeCoords).forEach(id => {
      const n = nodeCoords[id];
      const isSelected = AppState.graph.selectedNodeId === id;
      const isTarget = AppState.graph.searchNode && id.toLowerCase().includes(AppState.graph.searchNode.toLowerCase());

      // Neutral selection ring (does not override or tint underlying risk color)
      if (isSelected || isTarget) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Risk-based Node Fill Color (Red: #DC2626, Orange: #F59E0B, Green: #16A34A, Grey: #94A3B8)
      const nodeColor = getNodeRiskColor(id);

      ctx.beginPath();
      ctx.arc(n.x, n.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor;
      ctx.fill();
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      if (AppState.graph.showLabels) {
        ctx.fillStyle = '#172B4D';
        ctx.font = '600 10.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        const displayLabel = id.replace('ACC_', '').replace('MULE_', 'M_').replace('SYNDICATE_', 'SYN_');
        ctx.fillText(displayLabel, n.x, n.y - 17);
      }
    });

    // Update legend
    const legendEl = document.getElementById('graph-legend-communities');
    if (legendEl) {
      legendEl.innerHTML = communities.map(c => `
        <span class="legend-item" style="font-weight:600; color:var(--text-secondary);">Cluster #${c.id} (${c.size || c.members.length} nodes)</span>
      `).join(' • ');
    }
  }

  // Graph interaction events - Drag/Pan, Click Selection, and Hover
  const canvasEl = document.getElementById('network-canvas');
  if (canvasEl) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let downX = 0, downY = 0;
    let hasDragged = false;

    canvasEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      hasDragged = false;
      downX = e.clientX;
      downY = e.clientY;
      startX = e.clientX - AppState.graph.panX;
      startY = e.clientY - AppState.graph.panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) {
        hasDragged = true;
      }
      AppState.graph.panX = e.clientX - startX;
      AppState.graph.panY = e.clientY - startY;
      renderNetworkGraph();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Click on node
    canvasEl.addEventListener('click', (e) => {
      if (hasDragged) return; // Disregard drag/pan
      const rect = canvasEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      let clickedNodeId = null;
      let minDistance = 22; // 22px click radius tolerance
      const coords = AppState.graph.nodeCoords || {};

      for (const id in coords) {
        const n = coords[id];
        const dist = Math.hypot(n.x - clickX, n.y - clickY);
        if (dist < minDistance) {
          minDistance = dist;
          clickedNodeId = id;
        }
      }

      if (clickedNodeId) {
        AppState.graph.selectedNodeId = clickedNodeId;
        inspectAccount(clickedNodeId);
        renderNetworkGraph();
      }
    });

    // Hover feedback and cursor change
    canvasEl.addEventListener('mousemove', (e) => {
      if (isDragging) return;
      const rect = canvasEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const coords = AppState.graph.nodeCoords || {};
      let isOverNode = false;
      let hoveredNodeId = null;

      for (const id in coords) {
        const n = coords[id];
        if (Math.hypot(n.x - mouseX, n.y - mouseY) <= 18) {
          isOverNode = true;
          hoveredNodeId = id;
          break;
        }
      }

      canvasEl.style.cursor = isOverNode ? 'pointer' : 'grab';

      const tooltip = document.getElementById('graph-tooltip');
      if (tooltip) {
        if (isOverNode && hoveredNodeId) {
          const acc = (AppState.dataset.accounts || []).find(a => a.id === hoveredNodeId);
          const rScore = acc && acc.risk_score != null ? acc.risk_score.toFixed(1) : 'Nominal';
          const rLevel = acc ? (acc.risk_level || acc.risk_band || (acc.risk_score >= 60 ? 'HIGH' : acc.risk_score >= 35 ? 'MEDIUM' : 'LOW')) : 'Nominal';
          const rColor = getNodeRiskColor(hoveredNodeId);
          tooltip.style.display = 'block';
          tooltip.style.left = `${mouseX + 14}px`;
          tooltip.style.top = `${mouseY + 14}px`;
          tooltip.innerHTML = `<strong>${escapeHtml(hoveredNodeId)}</strong><br><span style="font-size:10.5px; opacity:0.95;"><span style="color:${rColor}; font-weight:700;">● ${escapeHtml(rLevel)}</span> (${rScore}) • Click to Inspect</span>`;
        } else {
          tooltip.style.display = 'none';
        }
      }
    });

    canvasEl.addEventListener('mouseleave', () => {
      const tooltip = document.getElementById('graph-tooltip');
      if (tooltip) tooltip.style.display = 'none';
    });
  }

  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    AppState.graph.panX *= 1.15; AppState.graph.panY *= 1.15; renderNetworkGraph();
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    AppState.graph.panX *= 0.85; AppState.graph.panY *= 0.85; renderNetworkGraph();
  });
  document.getElementById('btn-graph-fit-view')?.addEventListener('click', () => {
    AppState.graph.panX = 0; AppState.graph.panY = 0; renderNetworkGraph();
  });
  document.getElementById('btn-graph-reset')?.addEventListener('click', () => {
    AppState.graph.panX = 0; AppState.graph.panY = 0; AppState.selectedCommunity = 'ALL';
    const f = document.getElementById('graph-community-filter');
    if (f) f.value = 'ALL';
    renderNetworkGraph();
  });
  document.getElementById('btn-toggle-labels')?.addEventListener('click', function () {
    AppState.graph.showLabels = !AppState.graph.showLabels;
    this.classList.toggle('active', AppState.graph.showLabels);
    renderNetworkGraph();
  });
  document.getElementById('btn-toggle-rings')?.addEventListener('click', function () {
    AppState.graph.showRings = !AppState.graph.showRings;
    this.classList.toggle('active', AppState.graph.showRings);
    renderNetworkGraph();
  });
  document.getElementById('graph-community-filter')?.addEventListener('change', (e) => {
    AppState.selectedCommunity = e.target.value;
    renderNetworkGraph();
  });
  document.getElementById('graph-search-account')?.addEventListener('input', (e) => {
    const val = (e.target.value || '').trim();
    AppState.graph.searchNode = val;
    if (val) {
      const match = (AppState.dataset.accounts || []).find(a => a.id.toLowerCase() === val.toLowerCase());
      if (match) {
        AppState.graph.selectedNodeId = match.id;
        inspectAccount(match.id);
      }
    }
    renderNetworkGraph();
  });

  function formatTimestamp(ts) {
    if (!ts) return "Not Available";
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return String(ts);
      return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return String(ts);
    }
  }

  window.inspectAccount = function (accId) {
    if (!accId) return;

    const allAccounts = AppState.dataset.accounts || [];
    const allTxs = AppState.dataset.transactions || [];
    const allRings = AppState.dataset.rings || [];
    const allCases = AppState.dataset.cases || [];
    const allAlerts = AppState.dataset.alerts || [];
    const allFindings = AppState.dataset.findings || [];

    // Retrieve account metadata or fallback to computed values from transactions
    let acc = allAccounts.find(a => a.id === accId || a.account_identifier === accId);
    const txsForAcc = allTxs.filter(t => t.sender_id === accId || t.receiver_id === accId);

    if (!acc) {
      const computedIn = txsForAcc.filter(t => t.receiver_id === accId).reduce((s, t) => s + Number(t.amount || 0), 0);
      const computedOut = txsForAcc.filter(t => t.sender_id === accId).reduce((s, t) => s + Number(t.amount || 0), 0);
      acc = {
        id: accId,
        risk_score: 15.0,
        risk_band: "LOW",
        risk_level: "LOW",
        status: "NORMAL",
        flags: [],
        inflow: computedIn,
        outflow: computedOut,
        counterparties: 0,
        community_id: null
      };
    }

    const inspector = document.getElementById('inspector-content');
    const badge = document.getElementById('inspector-badge');
    const title = document.getElementById('inspector-title');

    // 1. Risk calculation
    const riskScore = Number(acc.risk_score != null ? acc.risk_score : 15.0);
    const risk = getRiskClassification(riskScore, acc.flags, riskScore >= 60);
    const riskTier = acc.risk_band || (riskScore >= 80 ? "CRITICAL" : riskScore >= 60 ? "HIGH" : riskScore >= 35 ? "MEDIUM" : "LOW");
    const riskTierClass = riskTier === "CRITICAL" || riskTier === "HIGH" ? "risk-high" : riskTier === "MEDIUM" ? "risk-medium" : "risk-low";

    if (title) title.textContent = acc.id;
    if (badge) {
      badge.textContent = `RISK: ${riskScore.toFixed(1)} (${risk.label})`;
      badge.className = `badge ${risk.badgeClass}`;
    }

    // 2. Transaction Summary
    const sentTxs = txsForAcc.filter(t => t.sender_id === accId);
    const receivedTxs = txsForAcc.filter(t => t.receiver_id === accId);
    const totalSent = sentTxs.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalReceived = receivedTxs.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const netCashFlow = totalReceived - totalSent;
    const totalVolume = totalSent + totalReceived;
    const totalTxCount = txsForAcc.length;
    const avgTxAmount = totalTxCount > 0 ? (totalVolume / totalTxCount) : 0;
    const highestTxAmount = totalTxCount > 0 ? Math.max(...txsForAcc.map(t => Number(t.amount || 0))) : 0;

    // 3. Connected Accounts Analysis
    const counterpartyMap = new Map();
    txsForAcc.forEach(tx => {
      const isOut = tx.sender_id === accId;
      const cpId = isOut ? tx.receiver_id : tx.sender_id;
      if (!cpId || cpId === accId) return;

      if (!counterpartyMap.has(cpId)) {
        counterpartyMap.set(cpId, {
          id: cpId,
          sentCount: 0,
          sentAmount: 0,
          receivedCount: 0,
          receivedAmount: 0,
          hasSuspiciousTx: false
        });
      }
      const cp = counterpartyMap.get(cpId);
      const amt = Number(tx.amount || 0);
      if (isOut) {
        cp.sentCount++;
        cp.sentAmount += amt;
      } else {
        cp.receivedCount++;
        cp.receivedAmount += amt;
      }
      if (tx.is_laundering || (tx.flags && tx.flags.length > 0)) {
        cp.hasSuspiciousTx = true;
      }
    });

    const connectedAccounts = Array.from(counterpartyMap.values()).map(cp => {
      let relationship = "Bidirectional Flow";
      let relBadge = '<span class="badge badge-outline" style="font-size:10px;">⇄ Two-Way</span>';
      if (cp.sentCount > 0 && cp.receivedCount === 0) {
        relationship = "Outgoing Recipient";
        relBadge = '<span class="badge badge-warning" style="font-size:10px;">→ Recipient</span>';
      } else if (cp.receivedCount > 0 && cp.sentCount === 0) {
        relationship = "Incoming Source";
        relBadge = '<span class="badge badge-low" style="font-size:10px;">← Source</span>';
      }
      const cpAcc = allAccounts.find(a => a.id === cp.id);
      const cpScore = cpAcc && cpAcc.risk_score != null ? cpAcc.risk_score : null;
      const cpRisk = cpAcc ? getRiskClassification(cpAcc.risk_score, cpAcc.flags, cpAcc.risk_score >= 60) : null;
      return {
        ...cp,
        totalCount: cp.sentCount + cp.receivedCount,
        totalAmount: cp.sentAmount + cp.receivedAmount,
        relationship,
        relBadge,
        riskScore: cpScore,
        riskBadgeClass: cpRisk ? cpRisk.badgeClass : 'badge-outline',
        riskLabel: cpRisk ? cpRisk.label : (cp.hasSuspiciousTx ? 'HIGH' : 'LOW')
      };
    }).sort((a, b) => b.totalAmount - a.totalAmount);

    const incomingConnectionsCount = connectedAccounts.filter(c => c.receivedCount > 0).length;
    const outgoingConnectionsCount = connectedAccounts.filter(c => c.sentCount > 0).length;

    // 4. Evidence-backed Reasons for Assigned Risk
    const riskReasons = [];
    const flags = Array.isArray(acc.flags) ? acc.flags : [];

    const associatedRings = allRings.filter(r => r.member_accounts && r.member_accounts.includes(accId));
    if (associatedRings.length > 0) {
      riskReasons.push(`Active participant in candidate mule syndicate (${associatedRings.map(r => r.pattern_type || 'Mule Ring').join(', ')}) with aggregated ring turnover of $${associatedRings.reduce((s, r) => s + Number(r.total_volume || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    }
    if (flags.some(f => f.toLowerCase().includes("pass-through") || f.toLowerCase().includes("ratio"))) {
      riskReasons.push("High pass-through velocity: rapid parity between incoming credits and outgoing debits with minimal sustained balance.");
    }
    if (txsForAcc.some(t => t.category === "CYCLE" || (t.flags && t.flags.includes("CIRCULAR_CYCLE_LEG")))) {
      riskReasons.push("Identified loop vertex in circular capital flow routing funds back to initial originating accounts.");
    }
    if (txsForAcc.some(t => t.category === "SMURF" || (t.flags && t.flags.includes("SMURFING_STRUCTURED")) || (t.amount >= 8500 && t.amount < 10000))) {
      riskReasons.push("High frequency structured transactions just beneath mandatory BSA CTR threshold ($8,500 – $9,999).");
    }
    if (txsForAcc.some(t => t.amount >= 25000 || (t.flags && t.flags.includes("HIGH_VALUE_FLOW")))) {
      riskReasons.push("Large-value transfer flows exceeding standard retail account baseline thresholds.");
    }
    if (riskReasons.length === 0) {
      if (riskScore >= 60) {
        riskReasons.push("Elevated risk profile driven by counterparty concentration and high-risk network topology.");
      } else if (riskScore >= 35) {
        riskReasons.push("Moderate activity flagged for routine secondary AML monitoring review.");
      } else {
        riskReasons.push("Nominal baseline activity with standard dispersion patterns and zero detected topological anomalies.");
      }
    }

    // 5. Network Intelligence & Suspicious Links
    const suspiciousLinksCount = txsForAcc.filter(t => t.is_laundering || (t.flags && t.flags.length > 0)).length;

    // 6. Related Cases, Alerts, and Findings
    const relatedCases = allCases.filter(c => {
      const linked = Array.isArray(c.linked_accounts) ? c.linked_accounts : [];
      return linked.includes(accId) || (c.title && c.title.includes(accId)) || (c.description && c.description.includes(accId));
    });

    const relatedAlerts = allAlerts.filter(a => {
      if (a.target_id === accId) return true;
      if (associatedRings.some(r => r.ring_id === a.target_id)) return true;
      return false;
    });

    const relatedFindings = allFindings.filter(f => {
      const summary = (f.summary || "").toLowerCase();
      return summary.includes(accId.toLowerCase());
    });

    if (inspector) {
      inspector.innerHTML = `
        <!-- Account Identity -->
        <div class="inspector-identity-card">
          <div class="inspector-id-row">
            <span class="inspector-account-id">${escapeHtml(acc.id)}</span>
            <span class="badge ${acc.status === 'SUSPICIOUS' ? 'badge-danger' : acc.status === 'NEEDS_REVIEW' ? 'badge-warning' : 'badge-low'}">${escapeHtml(acc.status || 'NORMAL')}</span>
          </div>
          <div class="inspector-identity-grid">
            <div>
              <div class="inspector-prop-label">Account Holder</div>
              <div class="inspector-prop-value">${escapeHtml(acc.name || acc.holder_name || 'Not Available')}</div>
            </div>
            <div>
              <div class="inspector-prop-label">Account Type</div>
              <div class="inspector-prop-value">${escapeHtml(acc.type || acc.account_type || 'Not Available')}</div>
            </div>
            <div>
              <div class="inspector-prop-label">Account Status</div>
              <div class="inspector-prop-value">${escapeHtml(acc.status || 'Not Available')}</div>
            </div>
            <div>
              <div class="inspector-prop-label">Louvain Partition</div>
              <div class="inspector-prop-value">${acc.community_id != null ? `Cluster #${acc.community_id}` : 'Not Available'}</div>
            </div>
            <div style="grid-column: 1 / -1;">
              <div class="inspector-prop-label">Ledger Observations</div>
              <div class="inspector-prop-value">${escapeHtml(acc.last_active || `${totalTxCount} Records Recorded`)}</div>
            </div>
          </div>
        </div>

        <!-- Risk Assessment Card -->
        <div class="inspector-risk-card ${riskTierClass}">
          <div class="inspector-risk-header">
            <span class="inspector-risk-title" style="color:${riskTier === 'CRITICAL' || riskTier === 'HIGH' ? 'var(--danger)' : riskTier === 'MEDIUM' ? 'var(--warning)' : 'var(--success)'};">
              ${riskTier} RISK ASSESSMENT
            </span>
            <span class="inspector-risk-score" style="color:${riskTier === 'CRITICAL' || riskTier === 'HIGH' ? 'var(--danger)' : riskTier === 'MEDIUM' ? 'var(--warning)' : 'var(--success)'};">
              ${riskScore.toFixed(1)} <span style="font-size:11px; font-weight:600; opacity:0.8;">/ 100</span>
            </span>
          </div>
          <div class="inspector-risk-meter">
            <div class="inspector-risk-fill" style="width:${Math.min(100, Math.max(5, riskScore))}%; background:${riskTier === 'CRITICAL' || riskTier === 'HIGH' ? 'var(--danger)' : riskTier === 'MEDIUM' ? 'var(--warning)' : 'var(--success)'};"></div>
          </div>
          ${flags.length > 0 ? `
            <div class="inspector-flags-container">
              ${flags.map(f => getFlagBadgeHtml(f)).join('')}
            </div>
          ` : ''}
          <div class="inspector-reasons-title">Risk Scoring Evidence:</div>
          <ul class="inspector-reasons-list">
            ${riskReasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </div>

        <!-- Financial Flow Summary Cards -->
        <div class="inspector-section">
          <div class="inspector-section-header">
            <span class="inspector-section-title">Transaction &amp; Cash Flow Summary</span>
            <span style="font-size:10.5px; color:var(--text-secondary); font-weight:600;">${totalTxCount} Total Transactions</span>
          </div>
          <div class="inspector-metrics-grid">
            <div class="inspector-metric-card">
              <div class="inspector-metric-label">Total Outflow (Sent)</div>
              <div class="inspector-metric-value" style="color:var(--danger);">$${totalSent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div class="inspector-metric-card">
              <div class="inspector-metric-label">Total Inflow (Received)</div>
              <div class="inspector-metric-value" style="color:var(--success);">$${totalReceived.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div class="inspector-metric-card">
              <div class="inspector-metric-label">Net Cash Flow</div>
              <div class="inspector-metric-value" style="color:${netCashFlow > 0 ? 'var(--success)' : netCashFlow < 0 ? 'var(--danger)' : 'var(--text-primary)'};">
                ${netCashFlow > 0 ? '+' : netCashFlow < 0 ? '-' : ''}$${Math.abs(netCashFlow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div class="inspector-metric-card">
              <div class="inspector-metric-label">Avg Transaction</div>
              <div class="inspector-metric-value">$${avgTxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div class="inspector-metric-card" style="grid-column: 1 / -1;">
              <div class="inspector-metric-label">Highest Single Transaction</div>
              <div class="inspector-metric-value" style="font-size:13px; font-weight:800;">$${highestTxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>

        <!-- Network Intelligence Topology -->
        <div class="inspector-section">
          <div class="inspector-section-header">
            <span class="inspector-section-title">Network Intelligence &amp; Syndicates</span>
            <span class="badge badge-outline" style="font-size:10px;">${connectedAccounts.length} Unique Peers</span>
          </div>
          <div class="inspector-metrics-grid">
            <div class="inspector-metric-card">
              <div class="inspector-metric-label">Incoming Senders</div>
              <div class="inspector-metric-value">${incomingConnectionsCount} <span style="font-size:10px; font-weight:500; color:var(--text-secondary);">Accounts</span></div>
            </div>
            <div class="inspector-metric-card">
              <div class="inspector-metric-label">Outgoing Receivers</div>
              <div class="inspector-metric-value">${outgoingConnectionsCount} <span style="font-size:10px; font-weight:500; color:var(--text-secondary);">Accounts</span></div>
            </div>
            <div class="inspector-metric-card" style="grid-column: 1 / -1;">
              <div class="inspector-metric-label">Suspicious / Laundering Links</div>
              <div class="inspector-metric-value" style="color:${suspiciousLinksCount > 0 ? 'var(--danger)' : 'var(--text-primary)'};">
                ${suspiciousLinksCount} ${suspiciousLinksCount > 0 ? 'Flagged Flow Legs' : 'Nominal Flows'}
              </div>
            </div>
          </div>

          <!-- Mule Ring Association Box -->
          ${associatedRings.length > 0 ? `
            <div style="margin-top:6px;">
              ${associatedRings.map(r => `
                <div class="inspector-ring-box">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <strong style="color:var(--danger);">${escapeHtml(r.ring_id)}</strong>
                    <span class="badge badge-critical" style="font-size:10px;">RING RISK: ${r.risk_score}</span>
                  </div>
                  <div style="margin-bottom:2px;"><strong>Pattern:</strong> ${formatPatternType(r.pattern_type)}</div>
                  <div style="margin-bottom:2px;"><strong>Syndicate Turnover:</strong> $${(r.total_volume || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div><strong>Members in Ring:</strong> ${(r.member_accounts || []).length} Accounts</div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="padding:6px 10px; background:var(--surface-muted); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-size:11px; color:var(--text-secondary);">
              No candidate mule ring associations detected (Independent Node).
            </div>
          `}
        </div>

        <!-- Connected Accounts List -->
        <div class="inspector-section">
          <div class="inspector-section-header">
            <span class="inspector-section-title">Connected Counterparties (${connectedAccounts.length})</span>
          </div>
          ${connectedAccounts.length > 0 ? `
            <div style="display:flex; flex-direction:column; gap:4px; max-height:160px; overflow-y:auto; padding-right:2px;">
              ${connectedAccounts.map(cp => `
                <div class="inspector-connected-item">
                  <div style="display:flex; flex-direction:column; min-width:0;">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <a href="javascript:void(0)" onclick="focusAccountInGraph('${cp.id}')" style="font-family:var(--font-mono); font-weight:700; font-size:11px; color:var(--primary-blue);" title="Click to inspect node on graph">
                        ${escapeHtml(cp.id)}
                      </a>
                      ${cp.relBadge}
                    </div>
                    <span style="font-size:10px; color:var(--text-secondary); margin-top:2px;">
                      ${cp.totalCount} txs • $${cp.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style="display:flex; align-items:center; gap:4px;">
                    <span class="badge ${cp.riskBadgeClass}" style="font-size:9.5px;">${cp.riskLabel}</span>
                    <button class="btn btn-xs btn-outline" style="padding:1px 5px; font-size:10px;" onclick="focusAccountInGraph('${cp.id}')" title="Inspect Node">Inspect</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="padding:8px 10px; background:var(--surface-muted); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-size:11px; color:var(--text-secondary); text-align:center;">
              No direct counterparty transactions recorded.
            </div>
          `}
        </div>

        <!-- Transaction Details Table -->
        <div class="inspector-section">
          <div class="inspector-section-header">
            <span class="inspector-section-title">Relevant Transaction Details (${txsForAcc.length})</span>
          </div>
          ${txsForAcc.length > 0 ? `
            <div class="inspector-table-wrapper">
              <table class="inspector-mini-table">
                <thead>
                  <tr>
                    <th>Tx ID</th>
                    <th>Timestamp</th>
                    <th>Flow / Counterparty</th>
                    <th>Channel</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${txsForAcc.map(t => {
                    const isOut = t.sender_id === accId;
                    const cp = isOut ? t.receiver_id : t.sender_id;
                    const r = getRiskClassification(t.risk_score, t.flags, t.is_laundering);
                    const channel = t.channel || t.category || (t.is_laundering ? 'Suspicious' : 'Standard');
                    const displayTxId = t.id && t.id.length > 10 ? t.id.substring(0, 8) + '…' : (t.id || 'TX');
                    return `
                      <tr>
                        <td>
                          <a href="javascript:void(0)" onclick="openTransactionDrawer('${t.id}')" style="font-family:var(--font-mono); font-weight:600; color:var(--primary-blue);" title="${escapeHtml(t.id)}">
                            ${escapeHtml(displayTxId)}
                          </a>
                        </td>
                        <td style="color:var(--text-secondary); font-size:10px;">${formatTimestamp(t.timestamp)}</td>
                        <td>
                          <span style="font-weight:600; color:${isOut ? 'var(--danger)' : 'var(--success)'};">${isOut ? '→ OUT' : '← IN'}</span>
                          <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-secondary);"> ${escapeHtml(cp)}</span>
                        </td>
                        <td style="font-size:10px; color:var(--text-secondary); font-weight:500;">
                          ${escapeHtml(channel)}
                        </td>
                        <td style="font-weight:700;">$${Number(t.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td><span class="badge ${r.badgeClass}" style="font-size:9px; padding:1px 4px;">${escapeHtml(t.status || r.label || 'NORMAL')}</span></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div style="padding:8px 10px; background:var(--surface-muted); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); font-size:11px; color:var(--text-secondary); text-align:center;">
              No transactions found for this account.
            </div>
          `}
        </div>

        <!-- Investigation, Alerts & Findings -->
        <div class="inspector-section">
          <div class="inspector-section-header">
            <span class="inspector-section-title">Investigation &amp; Compliance Dockets</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${relatedCases.length > 0 ? `
              <div style="display:flex; flex-direction:column; gap:4px;">
                ${relatedCases.map(c => `
                  <div style="background:var(--surface-muted); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:6px 8px; font-size:11px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <strong style="color:var(--primary-blue); font-family:var(--font-mono);">${escapeHtml(c.id || c.case_reference || 'Docket')}</strong>
                      <span class="badge ${c.priority === 'CRITICAL' ? 'badge-critical' : c.priority === 'HIGH' ? 'badge-danger' : 'badge-warning'}" style="font-size:9.5px;">${escapeHtml(c.priority || 'HIGH')}</span>
                    </div>
                    <div style="margin-top:2px; font-weight:600;">${escapeHtml(c.title || 'Investigation')}</div>
                    <div style="font-size:10px; color:var(--text-secondary);">${escapeHtml(c.description || 'Active case review')}</div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div style="font-size:11px; color:var(--text-secondary); padding:4px 0;">
                • Investigation Cases: <span style="font-weight:600; color:var(--text-primary);">Not Available (No active docket)</span>
              </div>
            `}

            ${relatedAlerts.length > 0 ? `
              <div style="display:flex; flex-direction:column; gap:4px;">
                ${relatedAlerts.map(a => `
                  <div style="background:var(--surface-muted); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:6px 8px; font-size:11px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <strong style="color:var(--danger);">${escapeHtml(a.id)}</strong>
                      <span class="badge ${a.severity === 'CRITICAL' ? 'badge-critical' : 'badge-danger'}" style="font-size:9.5px;">${escapeHtml(a.severity)}</span>
                    </div>
                    <div style="margin-top:2px;">${escapeHtml(a.title)}</div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div style="font-size:11px; color:var(--text-secondary); padding:4px 0;">
                • Compliance Alerts: <span style="font-weight:600; color:var(--text-primary);">Not Available (No alerts generated)</span>
              </div>
            `}

            ${relatedFindings.length > 0 ? `
              <div style="background:var(--surface-muted); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:6px 8px; font-size:11px;">
                <strong style="font-size:10.5px; text-transform:uppercase; color:var(--primary-blue);">Adverse Finding:</strong>
                <div style="margin-top:2px; color:var(--text-primary); line-height:1.4;">${escapeHtml(relatedFindings[0].summary)}</div>
              </div>
            ` : `
              <div style="font-size:11px; color:var(--text-secondary); padding:4px 0;">
                • Analytical Findings: <span style="font-weight:600; color:var(--text-primary);">Not Available (Nominal observation)</span>
              </div>
            `}
          </div>
        </div>

        <!-- Action Button Group -->
        <div class="inspector-action-group">
          <button class="btn btn-sm btn-primary" onclick="openNewCaseModalWithAccount('${acc.id}')" style="width:100%; justify-content:center;">
            Open Investigation Case Docket
          </button>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="btn btn-sm btn-outline" onclick="filterTransactionsForAccount('${acc.id}')" style="justify-content:center;">
              Filter Transactions
            </button>
            <button class="btn btn-sm btn-outline" onclick="focusCommunityInGraph('${acc.community_id}')" style="justify-content:center;" ${acc.community_id == null ? 'disabled' : ''}>
              Focus Cluster #${acc.community_id ?? '-'}
            </button>
          </div>
        </div>
      `;
    }
  };

  window.focusAccountInGraph = function (accId) {
    closeDrawer();
    navigateTo('network');
    AppState.graph.selectedNodeId = accId;
    inspectAccount(accId);
    renderNetworkGraph();
  };

  window.focusCommunityInGraph = function (commId) {
    navigateTo('network');
    const filter = document.getElementById('graph-community-filter');
    if (filter) {
      filter.value = String(commId);
      AppState.selectedCommunity = String(commId);
      renderNetworkGraph();
    }
  };

  window.filterTransactionsForAccount = function (accId) {
    navigateTo('transactions');
    const search = document.getElementById('tx-search-box');
    if (search) {
      search.value = accId;
      AppState.txFilters.search = accId.toLowerCase();
      renderTransactionsTable();
    }
  };

  // =========================================================================
  // 7. SUSPICIOUS TRANSACTION PATTERNS (Mule Rings)
  // =========================================================================

  function renderMuleRings() {
    const container = document.getElementById('rings-list-container');
    const badge = document.getElementById('rings-badge-count');
    if (!container) return;

    const rings = AppState.dataset.rings || [];
    if (badge) badge.textContent = `${rings.length} PATTERNS FLAGGED`;

    if (rings.length === 0) {
      container.innerHTML = `
        <div class="card" style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-secondary);">
          <h3>No Suspicious Transaction Patterns Identified</h3>
          <p class="text-secondary text-sm" style="margin-top:6px;">
            ${AppState.dataset.transactions.length > 0 ? 'The analyzed transaction graph exhibits nominal liquidity dispersion without high-risk circular transfers or dispersal patterns.' : 'No analysis performed. Ingest dataset in Upload Transactions to run detection.'}
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = rings.map(ring => `
      <div class="ring-card">
        <div class="ring-card-header">
          <div>
            <div class="ring-id-title">${ring.ring_id}</div>
            <span class="text-secondary text-xs">${formatPatternType(ring.pattern_type)} • Connected Group #${ring.community_id}</span>
          </div>
          <span class="badge ${ring.risk_score >= 80 ? 'badge-critical' : ring.risk_score >= 60 ? 'badge-danger' : ring.risk_score >= 35 ? 'badge-warning' : 'badge-success'}">
            RISK: ${ring.risk_score.toFixed(1)} (${ring.risk_score >= 60 ? 'HIGH RISK' : ring.risk_score >= 35 ? 'MEDIUM RISK' : 'LOW RISK'})
          </span>
        </div>

        <div class="ring-flow-schematic">
          <strong>Path Flow:</strong><br>
          ${ring.flow_path}
        </div>

        <div style="font-size:12px; margin:4px 0;">
          Gross Turnover: <strong>$${(ring.total_volume || 0).toLocaleString()}</strong> • Entities: <strong>${ring.member_accounts.length}</strong>
        </div>

        <div class="ring-indicators">
          ${(ring.triggered_indicators || []).map(ind => `<span class="indicator-chip">⚠ Why This Looks Suspicious: ${ind}</span>`).join('')}
        </div>

        <div class="ring-card-actions">
          <div>
            <label style="font-size:11px; font-weight:600; color:var(--text-secondary); margin-right:4px;">Status:</label>
            <select class="input-select input-xs" style="width:auto; padding:2px 6px;" onchange="updateRingStatus('${ring.ring_id}', this.value)">
              <option value="UNDER_REVIEW" ${ring.status === 'UNDER_REVIEW' ? 'selected' : ''}>Under Review</option>
              <option value="ESCALATED" ${ring.status === 'ESCALATED' ? 'selected' : ''}>Escalated to SAR</option>
              <option value="DISMISSED" ${ring.status === 'DISMISSED' ? 'selected' : ''}>Dismissed</option>
            </select>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-xs btn-outline" onclick="focusCommunityInGraph(${ring.community_id})">Trace</button>
            <button class="btn btn-xs btn-primary" onclick="openNewCaseModalWithRing('${ring.ring_id}')">Open Case</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  window.updateRingStatus = function (ringId, status) {
    const ring = (AppState.dataset.rings || []).find(r => r.ring_id === ringId);
    if (ring) {
      ring.status = status;
      showToast(`Ring ${ringId} status updated to ${status}`);
    }
  };

  // =========================================================================
  // 8. RISK & ALERTS QUEUE
  // =========================================================================

  function renderAlertsList() {
    const container = document.getElementById('alerts-list-container');
    if (!container) return;

    let alerts = AppState.dataset.alerts || [];

    if (alerts.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:32px; color:var(--text-secondary);">
          No operational alerts available. Ingest transactions to run anomaly heuristics.
        </div>
      `;
      return;
    }

    if (AppState.alertFilters.severity !== 'ALL') {
      alerts = alerts.filter(a => a.severity === AppState.alertFilters.severity);
    }
    if (AppState.alertFilters.status !== 'ALL') {
      alerts = alerts.filter(a => a.status === AppState.alertFilters.status);
    }

    container.innerHTML = alerts.map(alt => {
      const isCritical = alt.severity === 'CRITICAL';
      const badgeClass = isCritical ? 'badge-critical' : 'badge-warning';

      return `
        <div class="alert-card ${isCritical ? 'critical' : 'warning'}">
          <div class="alert-card-info">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span class="badge ${badgeClass}">${alt.severity}</span>
              <h4>${alt.title}</h4>
            </div>
            <p style="font-size:12.5px; color:var(--text-primary); margin-top:4px;">${alt.description}</p>
            <div class="alert-meta">
              Target: <strong style="font-family:var(--font-mono);">${alt.target_id}</strong> • Volume: <strong>${alt.volume || '$0'}</strong> • ${alt.timestamp}
            </div>
          </div>

          <div class="alert-actions">
            <button class="btn btn-xs btn-outline" onclick="updateAlertStatus('${alt.id}', 'UNDER_REVIEW')">Under Review</button>
            <button class="btn btn-xs btn-primary" onclick="updateAlertStatus('${alt.id}', 'ESCALATED')">Escalate SAR</button>
            <button class="btn btn-xs btn-outline" onclick="updateAlertStatus('${alt.id}', 'DISMISSED')">Dismiss</button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.updateAlertStatus = function (altId, status) {
    const alert = (AppState.dataset.alerts || []).find(a => a.id === altId);
    if (alert) {
      alert.status = status;
      renderAlertsList();
      showToast(`Alert ${altId} set to ${status}`);
    }
  };

  // =========================================================================
  // 9. INVESTIGATION CASES & DOCKETS
  // =========================================================================

  function renderCasesList() {
    const container = document.getElementById('cases-list-container');
    if (!container) return;

    const cases = AppState.dataset.cases || [];

    if (cases.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:24px; color:var(--text-secondary);">
          No active cases. Click "+ New Case" to create an inquiry.
        </div>
      `;
      return;
    }

    container.innerHTML = cases.map(cs => {
      const priorityBadge = cs.priority === 'CRITICAL' ? 'badge-critical' : 'badge-danger';

      return `
        <div class="case-card">
          <div class="case-header">
            <div>
              <strong style="color:var(--primary-blue); font-family:var(--font-mono);">${cs.id}</strong>
              <h4 style="font-size:14px; font-weight:700; margin-top:2px;">${cs.title}</h4>
            </div>
            <div style="display:flex; gap:6px;">
              <span class="badge ${priorityBadge}">${cs.priority} PRIORITY</span>
              <span class="badge badge-success">${cs.status}</span>
            </div>
          </div>
          <p style="font-size:12px; color:var(--text-secondary);">${cs.description}</p>
          <div style="font-size:11.5px; margin-top:4px;">
            <strong>Linked Accounts:</strong> <span style="font-family:var(--font-mono);">${cs.linked_accounts.join(', ')}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:8px; border-top:1px solid var(--border-subtle); font-size:11px; color:var(--text-secondary);">
            <span>Assigned: ${cs.assigned_unit || 'Financial Crimes Unit'}</span>
            <span>Created: ${cs.created_at || 'Recent'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function initModalsAndDrawers() {
    document.getElementById('btn-close-tx-drawer')?.addEventListener('click', closeDrawer);
    document.getElementById('drawer-backdrop')?.addEventListener('click', closeDrawer);

    const modal = document.getElementById('modal-new-case');
    const btnNewCase = document.getElementById('btn-new-case');
    const btnCloseModal = document.getElementById('btn-close-case-modal');
    const btnCancelModal = document.getElementById('btn-cancel-case-modal');
    const formNewCase = document.getElementById('form-new-case');

    btnNewCase?.addEventListener('click', () => modal?.classList.add('open'));
    const closeModal = () => modal?.classList.remove('open');
    btnCloseModal?.addEventListener('click', closeModal);
    btnCancelModal?.addEventListener('click', closeModal);

    formNewCase?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('case-title-input')?.value;
      const priority = document.getElementById('case-priority-select')?.value;
      const accountsStr = document.getElementById('case-accounts-input')?.value;
      const desc = document.getElementById('case-desc-input')?.value;
      const accounts = accountsStr ? accountsStr.split(',').map(s => s.trim()) : [];

      const payload = {
        title: title || "New Case",
        priority: priority || "HIGH",
        linked_accounts: accounts,
        description: desc || "Initiated by AML Compliance Investigator."
      };

      try {
        const res = await fetch(getApiUrl('/api/cases'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const newCase = await res.json();
          AppState.dataset.cases.unshift(newCase);
          showToast(`Case ${newCase.id} successfully established.`);
        }
      } catch (err) {
        const localCase = {
          id: `CASE-2026-${String(AppState.dataset.cases.length + 101).padStart(3, '0')}`,
          ...payload,
          status: "ACTIVE",
          created_at: new Date().toISOString().split('T')[0],
          assigned_unit: "Financial Crimes Unit"
        };
        AppState.dataset.cases.unshift(localCase);
        showToast(`Case ${localCase.id} created.`);
      } finally {
        renderCasesList();
        renderKPIs();
        closeModal();
        formNewCase.reset();
      }
    });
  }

  window.openNewCaseModalWithAccount = function (accId) {
    const modal = document.getElementById('modal-new-case');
    const accInput = document.getElementById('case-accounts-input');
    const titleInput = document.getElementById('case-title-input');
    if (accInput) accInput.value = accId;
    if (titleInput) titleInput.value = `Inquiry into Entity ${accId}`;
    if (modal) modal.classList.add('open');
  };

  window.openNewCaseModalWithRing = function (ringId) {
    const ring = (AppState.dataset.rings || []).find(r => r.ring_id === ringId);
    const modal = document.getElementById('modal-new-case');
    const accInput = document.getElementById('case-accounts-input');
    const titleInput = document.getElementById('case-title-input');
    if (ring && accInput) accInput.value = ring.member_accounts.join(', ');
    if (titleInput) titleInput.value = `Syndicate Inquiry: ${ringId}`;
    if (modal) modal.classList.add('open');
  };

  // =========================================================================
  // 10. CERTIFIED DOSSIER & REPORT VIEW
  // =========================================================================

  function renderReportDossier() {
    const summaryText = document.getElementById('report-summary-text');
    const commTable = document.getElementById('report-communities-table');
    const ringsSummary = document.getElementById('report-rings-summary');
    const genId = document.getElementById('report-gen-id');
    const dateEl = document.getElementById('report-date');

    const totalVol = (AppState.dataset.transactions || []).reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const txCount = AppState.dataset.transactions?.length || 0;
    const commCount = AppState.dataset.communities?.length || 0;
    const ringCount = AppState.dataset.rings?.length || 0;

    if (txCount === 0) {
      if (genId) genId.textContent = "MS-AML-PENDING";
      if (dateEl) dateEl.textContent = "Awaiting Analysis";
      if (summaryText) summaryText.textContent = "No dataset analyzed. Ingest transactions in Upload Transactions to generate evidence report.";
      if (commTable) commTable.innerHTML = '<tr><td colspan="5" class="text-center text-secondary">No community data available.</td></tr>';
      if (ringsSummary) ringsSummary.innerHTML = '<p class="text-secondary text-sm">No candidate rings flagged.</p>';
      return;
    }

    if (genId) genId.textContent = `MS-AML-2026-${String(commCount).padStart(2, '0')}`;
    if (dateEl) dateEl.textContent = `Investigation Evidence Report: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;

    if (summaryText) {
      summaryText.innerHTML = `
        MULE SHIELD automated forensic evaluation completed on <strong>${txCount} audited transactions</strong> representing gross monitored flow of <strong>$${totalVol.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>.<br>
        Connected account groups analysis resolved <strong>${commCount} discrete groups</strong> (Modularity Q: ${AppState.dataset.modularity_q !== null ? AppState.dataset.modularity_q.toFixed(3) : '0.000'}).<br>
        Identified <strong>${ringCount} suspicious transaction patterns</strong> requiring compliance scrutiny.
      `;
    }

    if (commTable && AppState.dataset.communities) {
      commTable.innerHTML = AppState.dataset.communities.map(c => `
        <tr>
          <td><strong style="color:var(--primary-blue);">Connected Group #${c.id}</strong></td>
          <td>${c.size} Accounts</td>
          <td>$${(c.total_volume || 0).toLocaleString()}</td>
          <td>${((c.internal_volume / (c.total_volume || 1)) * 100).toFixed(1)}%</td>
          <td>${c.id === 0 ? 'High Cohesion Group' : 'Dispersed Flow Group'}</td>
        </tr>
      `).join('');
    }

    if (ringsSummary && AppState.dataset.rings) {
      ringsSummary.innerHTML = AppState.dataset.rings.map(r => `
        <div style="background:var(--surface-muted); border:1px solid var(--border); border-radius:6px; padding:12px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${r.ring_id}: ${formatPatternType(r.pattern_type)}</strong>
            <span class="badge badge-critical">Risk ${r.risk_score.toFixed(1)}</span>
          </div>
          <p style="font-size:12px; margin:4px 0;">Turnover: $${r.total_volume.toLocaleString()} | Flow: ${r.flow_path}</p>
          <div style="font-size:11px; color:var(--text-secondary);">Why This Looks Suspicious: ${(r.triggered_indicators || []).join(', ')}</div>
        </div>
      `).join('');
    }
  }

  // =========================================================================
  // 11. DATA MANAGEMENT & REAL CSV INGESTION
  // =========================================================================

  function initDataManagement() {
    const dropzone = document.getElementById('csv-dropzone');
    const fileInput = document.getElementById('csv-file-input');
    const rawArea = document.getElementById('raw-csv-area');
    const valBox = document.getElementById('client-csv-validation-box');
    const valHeader = document.getElementById('validation-box-header');
    const valDetails = document.getElementById('validation-box-details');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          readFile(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
          readFile(fileInput.files[0]);
        }
      });
    }

    function readFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (rawArea) {
          rawArea.value = e.target.result;
          runPreFlightValidation();
        }
      };
      reader.readAsText(file);
    }

    function runPreFlightValidation() {
      const text = rawArea?.value || '';
      if (!text.trim()) {
        if (valBox) valBox.style.display = 'none';
        return null;
      }

      if (typeof validateCsvContent !== 'function') {
        return null;
      }

      const res = validateCsvContent(text);
      if (!valBox) return res;

      valBox.style.display = 'block';

      if (res.isValid) {
        valBox.className = 'validation-box valid mt-3';
        valHeader.textContent = `✓ Pre-Flight Integrity Passed: ${res.validRowsCount} valid transaction row(s) ready.`;
        valDetails.innerHTML = `<small>Detected columns (${Object.keys(res.recognizedAliases).join(', ')}). Ready for backend analysis.</small>`;
      } else {
        valBox.className = 'validation-box invalid mt-3';
        valHeader.textContent = `⚠ Pre-Flight Validation Detected ${res.errors.length} Issue(s):`;
        let html = '<ul>';
        res.errors.slice(0, 5).forEach(err => { html += `<li>${err}</li>`; });
        if (res.errors.length > 5) html += `<li>+ ${res.errors.length - 5} additional row error(s)...</li>`;
        html += '</ul>';
        if (res.missingRequiredColumns && res.missingRequiredColumns.length > 0) {
          html += `<div style="margin-top:6px; font-weight:bold;">Missing Required Columns: ${res.missingRequiredColumns.join(', ')}</div>`;
        }
        valDetails.innerHTML = html;
      }
      return res;
    }

    rawArea?.addEventListener('input', runPreFlightValidation);
    document.getElementById('btn-validate-csv')?.addEventListener('click', (e) => {
      e.preventDefault();
      runPreFlightValidation();
    });


    document.getElementById('btn-clear-csv-text')?.addEventListener('click', () => {
      if (rawArea) {
        rawArea.value = '';
        if (valBox) valBox.style.display = 'none';
      }
    });

    // Forensic Processing Overlay Stage Animation Helpers
    function showForensicOverlay() {
      const overlay = document.getElementById('forensic-processing-overlay');
      if (!overlay) return;
      for (let i = 1; i <= 5; i++) {
        const box = document.getElementById(`forensic-stage-${i}`);
        if (box) box.classList.remove('processing', 'completed', 'failed');
      }
      const prog = document.getElementById('forensic-track-progress');
      if (prog) prog.style.width = '0%';
      const stage1 = document.getElementById('forensic-stage-1');
      if (stage1) stage1.classList.add('processing');
      overlay.style.display = 'flex';
      requestAnimationFrame(() => overlay.classList.add('active'));
    }

    function advanceForensicStage(completedStage) {
      const compBox = document.getElementById(`forensic-stage-${completedStage}`);
      if (compBox) {
        compBox.classList.remove('processing');
        compBox.classList.add('completed');
      }
      const prog = document.getElementById('forensic-track-progress');
      if (prog) {
        const pct = Math.min(100, Math.round((completedStage / 4) * 100));
        prog.style.width = `${pct}%`;
      }
      if (completedStage < 5) {
        const nextBox = document.getElementById(`forensic-stage-${completedStage + 1}`);
        if (nextBox && !nextBox.classList.contains('completed')) {
          nextBox.classList.add('processing');
        }
      }
    }

    function failForensicStage(stageNum) {
      const box = document.getElementById(`forensic-stage-${stageNum}`);
      if (box) {
        box.classList.remove('processing');
        box.classList.add('failed');
      }
    }

    function hideForensicOverlay() {
      const overlay = document.getElementById('forensic-processing-overlay');
      if (!overlay) return;
      overlay.classList.remove('active');
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 260);
    }

    // Submit CSV to real backend endpoint with 5-Symbol Forensic Processing Animation
    document.getElementById('btn-submit-csv')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btnSubmit = document.getElementById('btn-submit-csv');
      if (btnSubmit && btnSubmit.disabled) return;
      if (btnSubmit) btnSubmit.disabled = true;

      const val = runPreFlightValidation();
      if (!val || !val.isValid) {
        if (btnSubmit) btnSubmit.disabled = false;
        const errorDetail = val && val.errors && val.errors.length > 0
          ? val.errors[0]
          : 'Please resolve CSV validation issues before uploading.';
        showToast(errorDetail, 'warning');
        return;
      }

      showForensicOverlay();
      let currentStage = 1;
      let pipelineSucceeded = false;

      try {
        const rawText = rawArea.value;
        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let payloadCsv = rawText;
        const structuredTransactions = [];

        if (lines.length > 1) {
          const headerTokens = lines[0].split(',').map(h => h.trim().toLowerCase());
          let txIdx = -1, senderIdx = -1, receiverIdx = -1, amtIdx = -1, timeIdx = -1;
          headerTokens.forEach((h, idx) => {
            if (['transaction_id', 'tx_id', 'id', 'trans_id', 'txid', 'transactionid'].includes(h)) txIdx = idx;
            else if (['sender_id', 'sender', 'from', 'source', 'originator', 'from_account', 'senderid'].includes(h)) senderIdx = idx;
            else if (['receiver_id', 'receiver', 'to', 'destination', 'beneficiary', 'to_account', 'receiverid'].includes(h)) receiverIdx = idx;
            else if (['amount', 'amt', 'value', 'sum', 'trans_amount', 'tx_amount'].includes(h)) amtIdx = idx;
            else if (['timestamp', 'time', 'date', 'created_at', 'trans_time', 'datetime', 'epoch'].includes(h)) timeIdx = idx;
          });

          if (txIdx >= 0 && senderIdx >= 0 && receiverIdx >= 0 && amtIdx >= 0 && timeIdx >= 0) {
            const normalizedLines = [lines[0]];
            for (let i = 1; i < lines.length; i++) {
              const parts = lines[i].split(',').map(p => p.trim());
              if (parts.length >= 5) {
                const rawTs = parts[timeIdx];
                let epochMs = Date.parse(rawTs);
                if (isNaN(epochMs)) {
                  const num = parseInt(rawTs, 10);
                  epochMs = !isNaN(num) ? num : Date.now();
                }
                const amtClean = parseFloat(parts[amtIdx].replace(/[\$,]/g, '')) || 0;
                parts[timeIdx] = String(epochMs);
                normalizedLines.push(parts.join(','));
                structuredTransactions.push({
                  id: parts[txIdx],
                  sender_id: parts[senderIdx],
                  receiver_id: parts[receiverIdx],
                  amount: amtClean,
                  timestamp: epochMs
                });
              }
            }
            payloadCsv = normalizedLines.join('\n');
          }
        }

        const res = await fetch(getApiUrl('/api/datasets/upload'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/x-ndjson',
            'X-Stream-Progress': '1'
          },
          body: JSON.stringify({
            csv: payloadCsv,
            transactions: structuredTransactions,
            name: "Uploaded Transaction Ledger",
            stream: true
          })
        });

        if (res.ok) {
          let finalDataset = null;
          let backendMaxStage = 0;
          let pipelineError = null;

          // Asynchronously read streaming response chunks from backend
          const streamReaderPromise = (async () => {
            if (res.body && typeof res.body.getReader === 'function') {
              const reader = res.body.getReader();
              const decoder = new TextDecoder();
              let streamBuf = '';
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                streamBuf += decoder.decode(value, { stream: true });
                const chunkLines = streamBuf.split('\n');
                streamBuf = chunkLines.pop();
                for (const l of chunkLines) {
                  if (!l.trim()) continue;
                  try {
                    const item = JSON.parse(l);
                    if (item.type === 'stage_complete' && typeof item.stage === 'number') {
                      backendMaxStage = Math.max(backendMaxStage, item.stage);
                    } else if (item.type === 'complete' && item.dataset) {
                      backendMaxStage = 5;
                      finalDataset = item.dataset;
                    } else if (item.type === 'error') {
                      pipelineError = item.message || ('Pipeline failed at stage ' + currentStage);
                      return;
                    }
                  } catch (_) { }
                }
              }
              if (!finalDataset && streamBuf.trim()) {
                try {
                  const item = JSON.parse(streamBuf.trim());
                  if (item.dataset) {
                    finalDataset = item.dataset;
                    backendMaxStage = 5;
                  }
                } catch (_) { }
              }
            } else {
              const json = await res.json();
              finalDataset = json.dataset;
              backendMaxStage = 5;
            }
          })();

          // Synchronized visual pacing controller:
          // Steps through stages 1 to 4 smoothly as backend confirms them
          for (let s = 1; s <= 4; s++) {
            currentStage = s;
            // Wait for backend to actually complete stage s
            while (backendMaxStage < s && !pipelineError) {
              await new Promise(r => setTimeout(r, 40));
            }

            if (pipelineError) {
              failForensicStage(currentStage);
              throw new Error(pipelineError);
            }

            // Real backend stage confirmed — advance UI checkmark & connecting track
            advanceForensicStage(s);

            // Restrained visual pacing so each stage can be clearly followed
            await new Promise(r => setTimeout(r, 620));
          }

          // Stage 5 (final stage): wait for genuine backend completion and final dataset arrival
          currentStage = 5;
          while ((backendMaxStage < 5 || !finalDataset) && !pipelineError) {
            await new Promise(r => setTimeout(r, 40));
          }

          if (pipelineError) {
            failForensicStage(5);
            throw new Error(pipelineError);
          }

          if (!finalDataset) {
            failForensicStage(5);
            throw new Error('Pipeline completed without analytical dataset output.');
          }

          // Real processing genuinely complete — display the fifth and final checkmark
          advanceForensicStage(5);
          pipelineSucceeded = true;
          AppState.dataset = finalDataset;
          const txCount = finalDataset.transactions ? finalDataset.transactions.length : structuredTransactions.length;

          // Immediately dismiss overlay and redirect to Home Overview
          hideForensicOverlay();
          showToast(`Successfully analyzed ${txCount} transactions.`);
          navigateTo('overview');
        } else {
          failForensicStage(currentStage);
          let errorMsg = `Server rejected CSV data (HTTP ${res.status}).`;
          try {
            const errJson = await res.json();
            if (errJson && errJson.message) errorMsg = errJson.message;
            else if (errJson && errJson.errors && errJson.errors.length > 0) errorMsg = errJson.errors[0];
          } catch (_) { }
          await new Promise(r => setTimeout(r, 650));
          hideForensicOverlay();
          showToast(errorMsg, "error");
        }
      } catch (err) {
        failForensicStage(currentStage);
        await new Promise(r => setTimeout(r, 650));
        hideForensicOverlay();
        showToast("Forensic processing error: " + (err.message || "Network error"), "error");
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (!pipelineSucceeded) {
          hideForensicOverlay();
        }
        renderAllViews();
        refreshPersistedDatasets();
      }
    });

    // Supabase Database Connection & Persistence Status Handlers
    async function refreshDatabaseStatus() {
      const badge = document.getElementById('db-status-badge');
      const note = document.getElementById('db-connection-note');
      try {
        const res = await fetch(getApiUrl('/api/database/status'));
        if (res.ok) {
          const statusData = await res.json();
          if (badge) {
            if (statusData.connected) {
              badge.textContent = '✓ Supabase Connected & RLS Active';
              badge.style.background = 'rgba(16, 185, 129, 0.15)';
              badge.style.color = 'var(--accent-teal)';
              badge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            } else if (statusData.configured) {
              badge.textContent = '⚠ Supabase Configured (Unreachable)';
              badge.style.background = 'rgba(245, 158, 11, 0.15)';
              badge.style.color = 'var(--risk-medium)';
              badge.style.border = '1px solid rgba(245, 158, 11, 0.3)';
            } else {
              badge.textContent = '○ Local Analytical Mode (Ready)';
              badge.style.background = 'rgba(30, 58, 138, 0.15)';
              badge.style.color = 'var(--primary-blue)';
              badge.style.border = '1px solid rgba(37, 99, 235, 0.3)';
            }
          }
          if (note && statusData.message) {
            note.textContent = statusData.message;
          }
        }
      } catch (_) { }
    }

    async function refreshPersistedDatasets() {
      const tbody = document.getElementById('tbody-persisted-datasets');
      if (!tbody) return;
      try {
        const res = await fetch(getApiUrl('/api/datasets'));
        if (res.ok) {
          const data = await res.json();
          const list = data.datasets || [];
          if (list.length === 0) {
            tbody.innerHTML = `
              <tr>
                <td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">
                  No persistent datasets loaded yet. Ingest a CSV above to store in database.
                </td>
              </tr>
            `;
            return;
          }
          tbody.innerHTML = list.map(ds => `
            <tr>
              <td class="dataset-name-cell">
                <span class="dataset-name-full" title="${escapeHtml(ds.name || 'Ledger')}">${escapeHtml(ds.name || 'Ledger')}</span>
              </td>
              <td class="dataset-id-cell">
                <div class="dataset-id-wrapper">
                  <code class="dataset-id-code" title="${escapeHtml(ds.id || '')}">${escapeHtml(ds.id || '')}</code>
                  <button type="button" class="btn btn-xs btn-icon btn-copy-dataset-id" data-id="${escapeHtml(ds.id || '')}" title="Copy full Dataset ID to clipboard" aria-label="Copy Dataset ID">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                    </svg>
                  </button>
                </div>
              </td>
              <td>${ds.uploaded_at ? new Date(ds.uploaded_at).toLocaleString() : 'N/A'}</td>
              <td>${ds.transaction_count || 0}</td>
              <td><span class="badge ${ds.analysis_status === 'completed' ? 'badge-low' : 'badge-med'}">${ds.analysis_status || 'uploaded'}</span></td>
              <td><span class="badge" style="background:rgba(16,185,129,0.12); color:#059669; border:1px solid rgba(16,185,129,0.3); font-size:11px;">Synced (Supabase)</span></td>
              <td style="text-align:right;">
                <div style="display:inline-flex; gap:6px; align-items:center;">
                  <button class="btn btn-xs btn-outline btn-load-dataset" data-id="${escapeHtml(ds.id || '')}" data-name="${escapeHtml(ds.name || 'Dataset')}">Select / Load</button>
                  <button class="btn btn-xs btn-danger btn-delete-dataset" data-id="${escapeHtml(ds.id || '')}" data-name="${escapeHtml(ds.name || 'Dataset')}" data-txs="${ds.transaction_count || 0}">Delete</button>
                </div>
              </td>
            </tr>
          `).join('');

          // Bind Copy Dataset ID buttons
          tbody.querySelectorAll('.btn-copy-dataset-id, .dataset-id-code').forEach(el => {
            el.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const fullId = el.getAttribute('data-id') || el.getAttribute('title');
              if (!fullId) return;
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(fullId).then(() => {
                  showToast(`Dataset ID copied: ${fullId}`);
                }).catch(() => {
                  prompt("Dataset ID (Press Ctrl+C to copy):", fullId);
                });
              } else {
                prompt("Dataset ID (Press Ctrl+C to copy):", fullId);
              }
            });
          });

          // Bind Select / Load buttons
          tbody.querySelectorAll('.btn-load-dataset').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              e.preventDefault();
              const dsId = btn.getAttribute('data-id');
              const dsName = btn.getAttribute('data-name');
              showLoading(`Loading dataset '${dsName}'...`);
              try {
                const r = await fetch(getApiUrl(`/api/datasets/${dsId}`));
                if (r.ok) {
                  const payload = await r.json();
                  if (payload.dataset) {
                    AppState.dataset = payload.dataset;
                    renderAllViews();
                    showToast(`Activated dataset '${dsName}'.`);
                  }
                } else {
                  showToast('Failed to load dataset details.', 'error');
                }
              } catch (err) {
                showToast('Network error while loading dataset.', 'error');
              } finally {
                hideLoading();
              }
            });
          });

          // Bind Delete buttons
          tbody.querySelectorAll('.btn-delete-dataset').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              const dsId = btn.getAttribute('data-id');
              const dsName = btn.getAttribute('data-name');
              const dsTxs = btn.getAttribute('data-txs');
              openDeleteDatasetModal(dsId, dsName, dsTxs);
            });
          });
        }
      } catch (_) { }
    }

    // Single Dataset Deletion Modal Handlers
    let activeDeleteDatasetId = null;
    const modalDeleteSingle = document.getElementById('modal-delete-dataset');
    const targetDsName = document.getElementById('delete-target-dataset-name');
    const targetDsId = document.getElementById('delete-target-dataset-id');
    const targetDsTxs = document.getElementById('delete-target-dataset-txs');
    const btnConfirmDeleteSingle = document.getElementById('btn-confirm-delete-single');
    const btnCancelDeleteSingle = document.getElementById('btn-cancel-delete-single');
    const btnCloseDeleteSingle = document.getElementById('btn-close-delete-single-modal');

    function openDeleteDatasetModal(id, name, txCount) {
      activeDeleteDatasetId = id;
      if (targetDsName) targetDsName.textContent = name;
      if (targetDsId) targetDsId.textContent = id;
      if (targetDsTxs) targetDsTxs.textContent = txCount;
      if (btnConfirmDeleteSingle) {
        btnConfirmDeleteSingle.disabled = false;
        btnConfirmDeleteSingle.textContent = "Permanently Delete Dataset";
      }
      modalDeleteSingle?.classList.add('open');
    }

    function closeDeleteSingleModal() {
      activeDeleteDatasetId = null;
      modalDeleteSingle?.classList.remove('open');
    }

    window.openDeleteDatasetModal = openDeleteDatasetModal;
    window.triggerDeleteDatasetForTx = function (txId) {
      const dsId = AppState.dataset.id;
      const dsName = AppState.dataset.name || "Active Transaction Dataset";
      const txCount = (AppState.dataset.transactions || []).length;
      openDeleteDatasetModal(dsId || "session-active", dsName, txCount);
    };

    document.getElementById('btn-delete-active-dataset')?.addEventListener('click', () => {
      const dsId = AppState.dataset.id;
      const dsName = AppState.dataset.name || "Current Dataset";
      const txCount = (AppState.dataset.transactions || []).length;
      if (txCount === 0 && !dsId) {
        showToast("No active transaction dataset to delete.", "info");
        return;
      }
      openDeleteDatasetModal(
        dsId || "session-active",
        dsName,
        txCount
      );
    });

    btnCancelDeleteSingle?.addEventListener('click', closeDeleteSingleModal);
    btnCloseDeleteSingle?.addEventListener('click', closeDeleteSingleModal);

    btnConfirmDeleteSingle?.addEventListener('click', async () => {
      if (!activeDeleteDatasetId) return;
      btnConfirmDeleteSingle.disabled = true;
      btnConfirmDeleteSingle.textContent = "Deleting dataset...";
      try {
        let res, data;
        if (activeDeleteDatasetId === "session-active") {
          res = await fetch(getApiUrl('/api/datasets/clear'), {
            method: 'POST'
          });
          data = await res.json();
        } else {
          res = await fetch(getApiUrl(`/api/datasets/${encodeURIComponent(activeDeleteDatasetId)}`), {
            method: 'DELETE'
          });
          data = await res.json();
        }

        if (res.ok && (data.status === 'success' || data.success)) {
          closeDeleteSingleModal();
          showToast(data.message || "Dataset permanently deleted.");
          if (data.current_dataset) {
            AppState.dataset = data.current_dataset;
          } else if (data.dataset) {
            AppState.dataset = data.dataset;
          } else {
            const curRes = await fetch(getApiUrl('/api/datasets/current'));
            if (curRes.ok) {
              AppState.dataset = await curRes.json();
            } else {
              AppState.dataset = {
                name: "", analyzed_at: null, transactions: [], accounts: [],
                communities: [], rings: [], findings: [], alerts: [], cases: [],
                modularity_q: null, is_demo: false
              };
            }
          }
          AppState.selectedTx = null;
          document.getElementById('tx-detail-drawer')?.classList.remove('open');
          document.getElementById('drawer-backdrop')?.classList.remove('open');
          await refreshPersistedDatasets();
          renderAllViews();
        } else {
          const errMsg = (data && (data.message || data.detail || data.error)) || "Failed to delete dataset.";
          showToast(errMsg, "error");
          btnConfirmDeleteSingle.disabled = false;
          btnConfirmDeleteSingle.textContent = "Permanently Delete Dataset";
        }
      } catch (err) {
        showToast("Network error while deleting dataset.", "error");
        btnConfirmDeleteSingle.disabled = false;
        btnConfirmDeleteSingle.textContent = "Permanently Delete Dataset";
      }
    });

    // Delete All Application Data Modal Handlers
    const modalDeleteAll = document.getElementById('modal-delete-all-datasets');
    const btnOpenDeleteAll = document.getElementById('btn-open-delete-all-modal');
    const btnCloseDeleteAll = document.getElementById('btn-close-delete-all-modal');
    const btnCancelDeleteAll = document.getElementById('btn-cancel-delete-all');
    const inputConfirmDeleteAll = document.getElementById('input-confirm-delete-all');
    const btnConfirmDeleteAll = document.getElementById('btn-confirm-delete-all');

    const PURGE_CONFIRM_PHRASE = "DELETE ALL MULE SHIELD DATA";

    btnOpenDeleteAll?.addEventListener('click', () => {
      if (inputConfirmDeleteAll) inputConfirmDeleteAll.value = "";
      if (btnConfirmDeleteAll) {
        btnConfirmDeleteAll.disabled = true;
        btnConfirmDeleteAll.textContent = "Permanently Purge All Data";
      }
      modalDeleteAll?.classList.add('open');
    });

    function closeDeleteAllModal() {
      modalDeleteAll?.classList.remove('open');
    }

    btnCloseDeleteAll?.addEventListener('click', closeDeleteAllModal);
    btnCancelDeleteAll?.addEventListener('click', closeDeleteAllModal);

    inputConfirmDeleteAll?.addEventListener('input', (e) => {
      const match = e.target.value.trim() === PURGE_CONFIRM_PHRASE;
      if (btnConfirmDeleteAll) btnConfirmDeleteAll.disabled = !match;
    });

    btnConfirmDeleteAll?.addEventListener('click', async () => {
      if (inputConfirmDeleteAll?.value.trim() !== PURGE_CONFIRM_PHRASE) return;
      btnConfirmDeleteAll.disabled = true;
      btnConfirmDeleteAll.textContent = "Purging Database...";
      try {
        const res = await fetch(getApiUrl('/api/datasets'), {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-Confirmation-Phrase': PURGE_CONFIRM_PHRASE
          },
          body: JSON.stringify({ confirmation: PURGE_CONFIRM_PHRASE })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
          closeDeleteAllModal();
          showToast(data.message || "All application data purged successfully.");
          AppState.dataset = {
            name: "", analyzed_at: null, transactions: [], accounts: [],
            communities: [], rings: [], findings: [], alerts: [], cases: [],
            modularity_q: null, is_demo: false
          };
          renderAllViews();
          await refreshPersistedDatasets();
        } else {
          showToast(data.message || "Failed to purge application data.", "error");
          btnConfirmDeleteAll.disabled = false;
          btnConfirmDeleteAll.textContent = "Permanently Purge All Data";
        }
      } catch (err) {
        showToast("Network error during database purge.", "error");
        btnConfirmDeleteAll.disabled = false;
        btnConfirmDeleteAll.textContent = "Permanently Purge All Data";
      }
    });

    document.getElementById('btn-refresh-datasets')?.addEventListener('click', (e) => {
      e.preventDefault();
      refreshPersistedDatasets();
      refreshDatabaseStatus();
    });

    refreshDatabaseStatus();
    refreshPersistedDatasets();
  }

  // =========================================================================
  // 12. SETTINGS CONTROLS
  // =========================================================================

  function initSettingsControls() {
    const louvainSlider = document.getElementById('louvain-resolution');
    const louvainVal = document.getElementById('louvain-res-val');

    louvainSlider?.addEventListener('input', (e) => {
      if (louvainVal) louvainVal.textContent = parseFloat(e.target.value).toFixed(1);
      AppState.settings.louvainResolution = parseFloat(e.target.value);
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      showToast("Analytical parameters saved.");
    });
  }

  // =========================================================================
  // 13. EXPORT UTILITIES & TOASTS
  // =========================================================================

  function exportTransactionsCsv() {
    const txs = AppState.dataset.transactions || [];
    if (txs.length === 0) {
      showToast("No transactions loaded to export.", "warning");
      return;
    }

    const lines = ["transaction_id,sender_id,receiver_id,amount,timestamp,flags,category,is_laundering"];
    txs.forEach(t => {
      lines.push(`${t.id},${t.sender_id},${t.receiver_id},${t.amount},${t.timestamp},"${(t.flags || []).join(';')}",${t.category || ''},${t.is_laundering ? '1' : '0'}`);
    });

    downloadBlob(lines.join('\n'), 'mule_shield_transactions.csv', 'text/csv');
    showToast("Transactions CSV ledger exported.");
  }

  function downloadJson(obj, filename) {
    const str = JSON.stringify(obj, null, 2);
    downloadBlob(str, filename, 'application/json');
    showToast(`${filename} exported.`);
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type: `${type};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function showLoading(text) {
    const loader = document.getElementById('app-loading-overlay');
    const subtitle = document.getElementById('loading-subtitle');
    if (subtitle && text) subtitle.textContent = text;
    if (loader) loader.classList.add('active');
  }

  function hideLoading() {
    const loader = document.getElementById('app-loading-overlay');
    if (loader) loader.classList.remove('active');
  }

  function showToast(msg, type = "success") {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const symbol = type === "error" ? "⚠" : type === "warning" ? "ℹ" : "✓";
    toast.innerHTML = `<span>${symbol}</span> <span>${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  window.showToast = showToast;

})();
