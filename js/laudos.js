import CFG, { esc } from './config.js';

/* ══════════════════════════════
   LAUDOS — POLLING (GET Apenas)
══════════════════════════════ */
async function buscarLaudos(manual = false) {
  if (manual) resetContagem();
  document.getElementById('skeletonRow').classList.add('show');
  try {
    const res = await fetch(
      `${CFG.supabaseUrl}/rest/v1/${CFG.tabela}?select=*&order=created_at.desc&limit=50`,
      { headers: { 'apikey': CFG.supabaseKey, 'Authorization': 'Bearer ' + CFG.supabaseKey } }
    );
    if (!res.ok) throw new Error('Supabase ' + res.status);
    const dados = await res.json();
    renderLaudos(dados);

    const aguardandoPdf = dados.some(l => window.aprovadosEm[l.id] && (Date.now() - window.aprovadosEm[l.id]) < 20000);
    if (aguardandoPdf) {
      clearTimeout(window._reprintCheck);
      window._reprintCheck = setTimeout(() => buscarLaudos(), 4000);
    }

    const pendentes = dados.filter(l => precisaValidacao(l));
    const novosVal = pendentes.filter(l => !window.vistosVal.has(l.id));
    if (novosVal.length > 0) {
      window.valPend += novosVal.length;
      novosVal.forEach(l => window.vistosVal.add(l.id));
      atualizarValNotif();
    }
  } catch (err) {
    console.error('Polling:', err);
    document.getElementById('pollStatus').textContent = 'Erro — tentando novamente em breve';
  } finally {
    document.getElementById('skeletonRow').classList.remove('show');
  }
}

function renderLaudos(lista) {
  const el = document.getElementById('laudosList');
  if (!lista || lista.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Nenhum laudo ainda</div><div class="empty-sub">Os laudos aparecerão aqui assim que a IA concluir a análise</div></div>`;
    return;
  }
  const primeiraVez = window.vistos.size === 0;
  lista.forEach(l => { if (!window.vistos.has(l.id)) { if (!primeiraVez) window.novosPend++; window.vistos.add(l.id); } });
  atualizarNotif();
  // Deduplicar por OS — mostrar apenas o registro mais recente de cada OS
  const unicos = Array.from(new Map(lista.map(l => [l.os, l])).values());
  el.innerHTML = unicos.map((l, idx) => {
    const isNovo = !primeiraVez && idx === 0 && window.novosPend > 0;
    const dt = l.created_at ? new Date(l.created_at).toLocaleString('pt-BR') : '—';
    let btnHtml;
    const precisaValidar = precisaValidacao(l);
    const aprovadoAgora = window.aprovadosEm[l.id] && (Date.now() - window.aprovadosEm[l.id]) < 20000;
    const pdfPronto = l.pdf_url && l.status === 'Aprovado' && !aprovadoAgora;

    if (precisaValidar) {
      btnHtml = `<button class="btn-download btn-download-disabled" style="background:linear-gradient(90deg,#92400E,#B45309);opacity:1;cursor:not-allowed;" title="Aguardando validação da Dra. Gabriela">🔒 Aguard. Validação</button>`;
    } else if (aprovadoAgora) {
      btnHtml = `<button class="btn-download btn-download-disabled" style="opacity:1;cursor:not-allowed;">⏳ Atualizando PDF...</button>`;
    } else if (pdfPronto) {
      btnHtml = `<a class="btn-download" href="${esc(l.pdf_url)}" target="_blank" download>⬇ Baixar PDF</a>`;
    } else if (l.pdf_url && l.pdf_url !== "Aguardando Validação") {
      btnHtml = `<a class="btn-download" href="${esc(l.pdf_url)}" target="_blank" download>⬇ Baixar PDF</a>`;
    } else {
      btnHtml = `<button class="btn-download btn-download-disabled">⏳ Gerando...</button>`;
    }
    const statusBadge = l.status === 'Aprovado'
      ? `<span style="position:absolute;top:10px;right:10px;font-family:'DM Mono',monospace;font-size:9px;background:#16A34A;color:#fff;padding:2px 7px;border-radius:3px;letter-spacing:.06em">✓ APROVADO</span>`
      : precisaValidacao(l)
        ? `<span style="position:absolute;top:10px;right:10px;font-family:'DM Mono',monospace;font-size:9px;background:var(--warning-border);color:#fff;padding:2px 7px;border-radius:3px;letter-spacing:.06em">⚠ VALIDAR</span>`
        : (isNovo ? '<span class="laudo-new">NOVO</span>' : '');
    // V6.3 fields (opcional)
    const hasV63 = l.artefatos || l.drive_folder_url || l.processamento_duracao_segundos;
    let v63Html = '';
    if (hasV63) {
      v63Html = '<div class="laudo-v63">';
      v63Html += '<div class="laudo-v63-header">Pipeline V6.3</div>';
      v63Html += '<div class="laudo-v63-stats">';
      if (l.processamento_duracao_segundos) {
        v63Html += `<div class="laudo-v63-stat">⏱️ <strong>${Math.round(l.processamento_duracao_segundos)}s</strong></div>`;
      }
      if (l.artefatos && Array.isArray(l.artefatos)) {
        v63Html += `<div class="laudo-v63-stat">📦 <strong>${l.artefatos.length}</strong> artefatos</div>`;
      }
      v63Html += '</div>';
      if (l.drive_folder_url) {
        v63Html += `<a class="laudo-drive-btn" href="${esc(l.drive_folder_url)}" target="_blank">📁 Pasta Drive</a>`;
      }
      if (l.artefatos && Array.isArray(l.artefatos) && l.artefatos.length > 0) {
        v63Html += '<div class="laudo-artefatos">';
        l.artefatos.slice(0,9).forEach(art => {
          const artUrl = art.url || '#';
          const artNome = art.nome || 'Artefato';
          const artOrdem = art.ordem || '?';
          v63Html += `<a class="laudo-art" href="${esc(artUrl)}" target="_blank" title="${esc(artNome)}"><span class="laudo-art-num">#${artOrdem}</span>${esc(artNome.substring(0,20))}</a>`;
        });
        v63Html += '</div>';
      }
      v63Html += '</div>';
    }
    return `
    <div class="laudo-row">
      ${statusBadge}
      <div class="laudo-info">
        <div class="laudo-paciente">${esc(l.nome_paciente || 'Paciente')}</div>
        <div class="laudo-meta">
          <span class="laudo-chip">OS <span>${esc(l.os || '—')}</span></span>
          <span class="laudo-chip">Tipo <span>${esc(l.tipo_exame || '—')}</span></span>
          <span class="laudo-chip">Doutor(a) <span>${esc(l.dentista || '—')}</span></span>
          <span class="laudo-chip">Recebido <span>${dt}</span></span>
        </div>
        ${v63Html}
      </div>
      ${btnHtml}
    </div>`;
  }).join('');
}

function atualizarNotif() {
  const el = document.getElementById('tabNotif');
  if (window.novosPend > 0) { el.textContent = window.novosPend; el.classList.add('show'); }
  else el.classList.remove('show');
}
function atualizarValNotif() {
  const el = document.getElementById('tabValNotif');
  if (window.valPend > 0) { el.textContent = window.valPend; el.classList.add('show'); }
  else el.classList.remove('show');
}

function iniciarPolling() {
  buscarLaudos();
  resetContagem();
  window.pollTimer = setInterval(() => { buscarLaudos(); resetContagem(); }, CFG.pollSeg * 1000);
}

function resetContagem() {
  clearInterval(window.countInt);
  window.countVal = CFG.pollSeg;
  renderContagem();
  window.countInt = setInterval(() => { window.countVal = Math.max(0, window.countVal - 1); renderContagem(); }, 1000);
}

function renderContagem() {
  const el = document.getElementById('countdown');
  if (el) el.textContent = window.countVal > 0 ? `próxima em ${window.countVal}s` : 'atualizando...';
}


/* ══════════════════════════════
   VALIDAÇÃO E ODONTOGRAMA VISUAL
══════════════════════════════ */
function precisaValidacao(l) {
  if (l.status === 'Aprovado') return false;
  // Usa campo rota do novo pipeline
  if (l.status === 'Aguardando Revisão' || l.status === 'Aguardando Validação') return true;
  if (l.alerta_validacao_humana === 'ALTO RISCO' || l.alerta_validacao_humana === 'REVISAR') return true;
  const achados = l.achados_radiograficos;
  if (achados) {
    let obj = achados;
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch(e) { obj = null; } }
    if (obj) {
      const textos = Object.values(obj).join(' ');
      if (textos.includes('ATENÇÃO DRA')) return true;
    }
  }
  if (l.status === 'Concluído') return true;
  return false;
}

function extrairDivergencia(l) {
  // Prioriza motivos_revisao do novo pipeline (confidence scoring)
  if (l.motivos_revisao && Array.isArray(l.motivos_revisao) && l.motivos_revisao.length > 0) {
    return l.motivos_revisao.join(' · ');
  }
  if (l.motivos_revisao && typeof l.motivos_revisao === 'string') {
    try {
      const arr = JSON.parse(l.motivos_revisao);
      if (arr.length > 0) return arr.join(' · ');
    } catch(e) {}
  }
  // Fallback: analisa texto de achados (pipeline antigo)
  let achados = l.achados_radiograficos;
  if (typeof achados === 'string') { try { achados = JSON.parse(achados); } catch(e) { achados = null; } }
  if (achados) {
    for (const val of Object.values(achados)) {
      if (val && typeof val === 'string' && val.includes('ATENÇÃO DRA')) {
        const match = val.match(/\[ATENÇÃO DRA[^\]]+\]/);
        if (match) return match[0].replace('[','').replace(']','');
      }
    }
  }
  if (l.alerta_validacao_humana === 'ALTO RISCO') {
    return 'Este laudo contém achados de alto risco que requerem revisão imediata.';
  }
  return 'Laudo aguardando revisão e aprovação pela radiologista responsável.';
}

export { buscarLaudos, renderLaudos, atualizarNotif, atualizarValNotif, iniciarPolling, resetContagem, renderContagem, precisaValidacao, extrairDivergencia };
