import CFG, { esc } from './config.js';
import { loadChartJS } from './validacao.js';

window.DASH = {
  periodDays: 7,
  data: null,
  charts: {},
  refreshTimer: null,
  loading: false
};

// ── Data Fetching ──────────────────────────────────────────────
async function fetchDashboardData() {
  try {
    // Primary: try Supabase for advanced metrics
    const since = new Date(Date.now() - window.DASH.periodDays * 86400000).toISOString();
    
    // Buscar laudos do Supabase (métricas básicas sempre disponíveis)
    const resp = await fetch(
      `${CFG.supabaseUrl}/rest/v1/laudos?select=os,nome_paciente,status,created_at,processamento_duracao_segundos,drive_folder_url,score_concordancia,nivel_dificuldade,validado_em,engine_version,cost_total_usd,cost_total_brl,campos_editados_count,campos_confirmados_count,artefatos&order=created_at.desc&limit=200`,
      { headers: { 'apikey': CFG.supabaseKey, 'Authorization': 'Bearer ' + CFG.supabaseKey } }
    );
    const laudos = await resp.json();
    
    if (!Array.isArray(laudos)) throw new Error('Invalid Supabase response');
    
    // Aggregate client-side
    return aggregateDashboardData(laudos);
  } catch (e) {
    console.warn('Dashboard: Supabase fetch failed, trying Drive fallback', e);
    // Fallback: try to load cached dashboard_data.json from Drive
    return null;
  }
}

function aggregateDashboardData(laudos) {
  const now = new Date();
  const since = new Date(now - window.DASH.periodDays * 86400000);
  
  // Filter by period
  const filtered = laudos.filter(l => {
    const d = new Date(l.created_at);
    return d >= since;
  });
  
  const n = filtered.length;
  let totalCost = 0, costCount = 0;
  let totalDuration = 0;
  let totalCorrecoes = 0, correcoesCount = 0;
  let approvedNoEdit = 0, approvedWithEdit = 0;
  let dailyCosts = {}, dailyVolumes = {}, dailyCorrections = {};
  
  const topCost = [...filtered].filter(l => l.cost_total_usd).sort((a,b) => b.cost_total_usd - a.cost_total_usd);
  const topSlow = [...filtered].filter(l => l.processamento_duracao_segundos).sort((a,b) => b.processamento_duracao_segundos - a.processamento_duracao_segundos);
  
  filtered.forEach(l => {
    const date = (l.created_at || '').slice(0, 10);
    dailyVolumes[date] = (dailyVolumes[date] || 0) + 1;
    
    if (l.cost_total_usd) {
      totalCost += l.cost_total_usd;
      costCount++;
      dailyCosts[date] = (dailyCosts[date] || 0) + l.cost_total_usd;
    }
    if (l.processamento_duracao_segundos) {
      totalDuration += l.processamento_duracao_segundos;
    }
    
    // Corrections (if available)
    if (l.campos_editados_count !== null && l.campos_editados_count !== undefined) {
      totalCorrecoes += l.campos_editados_count;
      if (l.status === 'Aprovado') {
        if (l.campos_editados_count === 0) approvedNoEdit++;
        else {
          approvedWithEdit++;
          correcoesCount++;
          dailyCorrections[date] = (dailyCorrections[date] || 0) + l.campos_editados_count / 7;
        }
      }
    }
  });
  
  return {
    total_laudos: n,
    custo_total_usd: totalCost,
    custo_medio_usd: costCount > 0 ? totalCost / costCount : 0,
    laudos_com_custo: costCount,
    duracao_media_s: n > 0 ? totalDuration / n : 0,
    aprovados_sem_edicao: approvedNoEdit,
    aprovados_com_edicao: approvedWithEdit,
    pct_sem_edicao: (approvedNoEdit + approvedWithEdit) > 0 ? Math.round(100 * approvedNoEdit / (approvedNoEdit + approvedWithEdit)) : 0,
    media_correcoes: correcoesCount > 0 ? (totalCorrecoes / correcoesCount) : 0,
    daily_costs: dailyCosts,
    daily_volumes: dailyVolumes,
    daily_corrections: dailyCorrections,
    top_cost: topCost.slice(0, 5),
    top_slow: topSlow.slice(0, 5),
    raw: filtered
  };
}

// ── Render ──────────────────────────────────────────────────────
function renderDashboard() {
  const panel = document.getElementById('panel-dashboard');
  if (!panel) return;
  
  if (!window.DASH.data) {
    panel.innerHTML = '<div class="dash-loading">📊 Carregando métricas...</div>';
    return;
  }
  
  const d = window.DASH.data;
  if (!d || d.total_laudos === 0) {
    panel.innerHTML = '<div class="dash-error">⚠️ Nenhum dado disponível para o período selecionado.</div>';
    return;
  }
  
  const fmtUSD = (v) => v != null ? '$' + v.toFixed(4) : '--';
  const fmtBRL = (v) => v != null ? 'R$' + v.toFixed(2) : '--';
  const pct = (v) => v != null ? v + '%' : '--';
  
  panel.innerHTML = `
    <!-- Period Filter -->
    <div class="dash-filters">
      ${[7, 30, 90, 180].map(days => 
        `<button class="dash-filter-btn ${window.DASH.periodDays === days ? 'active' : ''}" 
          onclick="setPeriod(${days})">${days}d</button>`
      ).join('')}
      <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text-3);margin-left:auto">
        ${d.total_laudos} laudos · atualizado ${new Date().toLocaleTimeString('pt-BR')}
      </span>
    </div>
    
    <!-- KPI Cards -->
    <div class="dash-grid">
      <div class="dash-card dash-card-accent-green">
        <div class="dash-card-value">${fmtBRL(d.custo_total_usd ? d.custo_total_usd * 5.5 : null)}</div>
        <div class="dash-card-label">💰 Custo Total Est.</div>
        <div class="dash-card-sub">${fmtUSD(d.custo_total_usd)} USD · ${d.laudos_com_custo} laudos</div>
      </div>
      <div class="dash-card dash-card-accent-blue">
        <div class="dash-card-value">${d.total_laudos}</div>
        <div class="dash-card-label">📊 Laudos Processados</div>
        <div class="dash-card-sub">em ${window.DASH.periodDays} dias</div>
      </div>
      <div class="dash-card dash-card-accent-amber">
        <div class="dash-card-value">${fmtUSD(d.custo_medio_usd)}</div>
        <div class="dash-card-label">💵 Custo Médio / Laudo</div>
        <div class="dash-card-sub">⏱️ ${d.duracao_media_s.toFixed(0)}s médio</div>
      </div>
      <div class="dash-card dash-card-accent-red">
        <div class="dash-card-value">${pct(d.pct_sem_edicao)}</div>
        <div class="dash-card-label">✅ Aprovados sem Edição</div>
        <div class="dash-card-sub">${d.media_correcoes.toFixed(1)} correções/laudo (média)</div>
      </div>
    </div>
    
    <!-- Charts -->
    <div class="dash-charts">
      <div class="dash-chart-box">
        <div class="dash-chart-title">📈 Custo por Dia (USD)</div>
        <div class="dash-chart-wrap"><canvas id="chartCostTimeline"></canvas></div>
      </div>
      <div class="dash-chart-box">
        <div class="dash-chart-title">📊 Volume de Laudos / Dia</div>
        <div class="dash-chart-wrap"><canvas id="chartDailyVolume"></canvas></div>
      </div>
      <div class="dash-chart-box">
        <div class="dash-chart-title">📉 Taxa de Correções (média)</div>
        <div class="dash-chart-wrap"><canvas id="chartCorrectionRate"></canvas></div>
      </div>
      <div class="dash-chart-box">
        <div class="dash-chart-title">🦷 Top 5 — Maior Custo</div>
        <div class="dash-chart-wrap"><canvas id="chartTopCost"></canvas></div>
      </div>
    </div>
    
    <!-- Top 5 Tables -->
    <div class="dash-tables">
      <div class="dash-table-box">
        <div class="dash-chart-title">🔴 Maior Custo (USD)</div>
        <table class="dash-table">
          <tr><th>OS</th><th>Paciente</th><th>Custo</th><th>⏱️</th></tr>
          ${d.top_cost.map(l => `
            <tr>
              <td>${esc(l.os)}</td>
              <td>${esc((l.nome_paciente||'').substring(0,20))}</td>
              <td>${fmtUSD(l.cost_total_usd)}</td>
              <td>${(l.processamento_duracao_segundos||0).toFixed(0)}s</td>
            </tr>
          `).join('')}
        </table>
      </div>
      <div class="dash-table-box">
        <div class="dash-chart-title">🐌 Mais Lentos</div>
        <table class="dash-table">
          <tr><th>OS</th><th>Paciente</th><th>⏱️</th><th>Score</th></tr>
          ${d.top_slow.map(l => `
            <tr>
              <td>${esc(l.os)}</td>
              <td>${esc((l.nome_paciente||'').substring(0,20))}</td>
              <td>${(l.processamento_duracao_segundos||0).toFixed(0)}s</td>
              <td>${l.score_concordancia||'--'}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    </div>
  `;
  
  // Render charts (after DOM update)
  if (window.Chart) setTimeout(renderCharts, 100);
}

// ── Charts ─────────────────────────────────────────────────────
function renderCharts() {
  if (!window.DASH.data || !window.Chart) return;
  const d = window.DASH.data;
  
  // Destroy existing charts
  Object.values(window.DASH.charts).forEach(c => c.destroy());
  window.DASH.charts = {};
  
  const theme = {
    textColor: '#a0a0a0',
    gridColor: 'rgba(255,255,255,0.06)',
    font: "'DM Mono', monospace"
  };
  
  function makeChart(canvasId, type, labels, datasets) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    window.DASH.charts[canvasId] = new Chart(ctx, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: theme.textColor, font: { size: 8, family: theme.font }, maxTicksLimit: 10 }, grid: { color: theme.gridColor } },
          y: { ticks: { color: theme.textColor, font: { size: 8, family: theme.font } }, grid: { color: theme.gridColor }, beginAtZero: true }
        }
      }
    });
  }
  
  // Cost timeline
  const costLabels = Object.keys(d.daily_costs).sort();
  const costValues = costLabels.map(k => d.daily_costs[k]);
  makeChart('chartCostTimeline', 'line', costLabels, [{
    data: costValues,
    borderColor: '#4ade80',
    backgroundColor: 'rgba(74,222,128,0.1)',
    fill: true,
    tension: 0.3,
    pointRadius: 2
  }]);
  
  // Daily volume
  const volLabels = Object.keys(d.daily_volumes).sort();
  const volValues = volLabels.map(k => d.daily_volumes[k]);
  makeChart('chartDailyVolume', 'bar', volLabels, [{
    data: volValues,
    backgroundColor: '#60a5fa',
    borderRadius: 2
  }]);
  
  // Correction rate
  const corrLabels = Object.keys(d.daily_corrections).sort();
  const corrValues = corrLabels.map(k => d.daily_corrections[k]);
  if (corrLabels.length > 0) {
    makeChart('chartCorrectionRate', 'line', corrLabels, [{
      data: corrValues,
      borderColor: '#fbbf24',
      backgroundColor: 'rgba(251,191,36,0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 2
    }]);
  }
  
  // Top cost horizontal bar
  const topLabels = d.top_cost.map(l => l.os);
  const topValues = d.top_cost.map(l => l.cost_total_usd || 0);
  if (topLabels.length > 0) {
    makeChart('chartTopCost', 'bar', topLabels, [{
      data: topValues,
      backgroundColor: '#f87171',
      borderRadius: 2
    }]);
    // Make horizontal
    if (window.DASH.charts['chartTopCost']) {
      window.DASH.charts['chartTopCost'].options.indexAxis = 'y';
      window.DASH.charts['chartTopCost'].update();
    }
  }
}

// ── Actions ─────────────────────────────────────────────────────
function setPeriod(days) {
  window.DASH.periodDays = days;
  loadDashboard();
}

async function loadDashboard() {
  if (window.DASH.loading) return;
  window.DASH.loading = true;
  
  var panel = document.getElementById('panel-dashboard');
  if (!panel) { console.error('Dashboard: panel-dashboard not found'); return; }
  panel.innerHTML = '<div class="dash-loading">📊 Carregando métricas do Supabase...</div>';
  
  try {
    window.DASH.data = await fetchDashboardData();
  } catch(e) {
    console.error('Dashboard load error:', e);
    panel.innerHTML = '<div class="dash-error">⚠️ Erro ao carregar: ' + (e.message || 'desconhecido') + '<br><small>Verifique o console (F12) para detalhes</small></div>';
    window.DASH.loading = false;
    return;
  }
  
  window.DASH.loading = false;
  
  if (!window.DASH.data || window.DASH.data.total_laudos === 0) {
    panel.innerHTML = '<div class="dash-loading">📊 Nenhum laudo encontrado nos últimos ' + window.DASH.periodDays + ' dias.<br><small>Tente ampliar o período ou aguardar novas execuções.</small></div>';
  } else {
    renderDashboard();
  }
  
  // Carrega Chart.js em background para gráficos
  if (!window.Chart) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = function() { if (window.DASH.data) renderCharts(); };
    s.onerror = function() { console.warn('Chart.js CDN indisponível'); };
    document.head.appendChild(s);
  }
}

function startDashboardRefresh() {
  if (window.DASH.refreshTimer) clearInterval(window.DASH.refreshTimer);
  window.DASH.refreshTimer = setInterval(() => {
    if (document.getElementById('panel-dashboard')?.style.display !== 'none') {
      loadDashboard();
    }
  }, 60000);
}

// ── Init ───────────────────────────────────────────────────────
// Called when Dashboard tab is activated
function initDashboard() {
  loadDashboard();
  startDashboardRefresh();
}


export { initDashboard, loadDashboard, setPeriod };
