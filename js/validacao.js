import CFG, { esc, escHtml } from './config.js';

import { precisaValidacao, extrairDivergencia } from './laudos.js';
async function buscarValidacoes(manual = false) {
  document.getElementById('skeletonVal').classList.add('show');
  document.getElementById('valPollDot').classList.remove('off');
  try {
    const res = await fetch(
      `${CFG.supabaseUrl}/rest/v1/${CFG.tabela}?select=*&order=created_at.desc&limit=100`,
      { headers: { 'apikey': CFG.supabaseKey, 'Authorization': 'Bearer ' + CFG.supabaseKey } }
    );
    if (!res.ok) throw new Error('Supabase ' + res.status);
    const dados = await res.json();
    const paraValidar = dados.filter(l => l.status !== 'Erro - Imagem Inválida');
    renderValidacoes(paraValidar);
  } catch (err) {
    console.error('Validação polling:', err);
    document.getElementById('valPollStatus').textContent = 'Erro ao carregar';
    document.getElementById('valPollDot').classList.add('off');
  } finally {
    document.getElementById('skeletonVal').classList.remove('show');
  }
}


// ── Montar payload de aprovação para envio ao n8n ─────────────
function montarPayloadAprovacao(id, l, updatePayload) {
  const state = window.blocosState[id] || {};
  const vals  = window.blocosVals[id]  || {};
  
  // Campos originais da IA (antes da edição)
  let origAchados = l.achados_radiograficos || {};
  if (typeof origAchados === 'string') { try { origAchados = JSON.parse(origAchados); } catch(e) { origAchados = {}; } }
  let origImpressao = l.impressao_radiografica || [];
  if (typeof origImpressao === 'string') { try { origImpressao = JSON.parse(origImpressao); } catch(e) { origImpressao = [origImpressao]; } }
  let origRec = l.recomendacoes_orthox || [];
  if (typeof origRec === 'string') { try { origRec = JSON.parse(origRec); } catch(e) { origRec = [origRec]; } }

  // Mapear campos de achados_radiograficos
  const camposAchados = ['denticao_ausencias','reabilitacoes_implantes','tratamentos_endodonticos_restauracoes','avaliacao_ossea_periodontal','seios_maxilares_estruturas_adjacentes'];
  const detalhes = [];
  const camposEditados = [];
  const camposConfirmados = [];

  for (const campo of camposAchados) {
    const estado = state[campo] || 'pendente';
    const original = (origAchados[campo] || '').replace(/\[ATENÇÃO DRA.*?\]/g, '').trim();
    const aprovado = (vals[campo] || updatePayload.achados_radiograficos[campo] || '').replace(/\[ATENÇÃO DRA.*?\]/g, '').trim();
    
    if (estado === 'editado') {
      camposEditados.push(campo);
      detalhes.push({ campo, estado: 'editado', valor_original_ia: original, valor_aprovado_medico: aprovado });
    } else if (estado === 'confirmado') {
      camposConfirmados.push(campo);
      detalhes.push({ campo, estado: 'confirmado', valor_original_ia: original, valor_aprovado_medico: aprovado });
    } else {
      // pendente — o médico não interagiu com este campo (equivale a confirmado implicitamente)
      detalhes.push({ campo, estado: 'nao_alterado', valor_original_ia: original, valor_aprovado_medico: aprovado });
    }
  }

  // Impressão radiográfica
  const impState = state['_impressao'] || 'pendente';
  const impOrig = Array.isArray(origImpressao) ? origImpressao.join('\n') : origImpressao;
  const impAprov = Array.isArray(updatePayload.impressao_radiografica) ? updatePayload.impressao_radiografica.join('\n') : updatePayload.impressao_radiografica;
  detalhes.push({ campo: 'impressao_radiografica', estado: impState === 'editado' ? 'editado' : impState === 'confirmado' ? 'confirmado' : 'nao_alterado', valor_original_ia: impOrig, valor_aprovado_medico: impAprov });
  if (impState === 'editado') camposEditados.push('impressao_radiografica');
  else if (impState === 'confirmado') camposConfirmados.push('impressao_radiografica');

  // Recomendações
  const recState = state['_recomendacoes'] || 'pendente';
  const recOrig = Array.isArray(origRec) ? origRec.join('\n') : origRec;
  const recAprov = Array.isArray(updatePayload.recomendacoes_orthox) ? updatePayload.recomendacoes_orthox.join('\n') : updatePayload.recomendacoes_orthox;
  detalhes.push({ campo: 'recomendacoes_orthox', estado: recState === 'editado' ? 'editado' : recState === 'confirmado' ? 'confirmado' : 'nao_alterado', valor_original_ia: recOrig, valor_aprovado_medico: recAprov });
  if (recState === 'editado') camposEditados.push('recomendacoes_orthox');
  else if (recState === 'confirmado') camposConfirmados.push('recomendacoes_orthox');

  return {
    laudo_id: id,
    os: l.os,
    nome_paciente: l.nome_paciente,
    dentista: l.dentista || '',
    data_exame: l.data_exame || '',
    tipo_exame: l.tipo_exame || 'panoramica',
    status: 'Aprovado',
    validado_em: new Date().toISOString(),
    pdf_url: l.pdf_url || '',
    drive_folder_url: l.drive_folder_url || '',
    imagem_url: l.imagem_url || '',
    ajustes: {
      total_campos: camposAchados.length + 2,
      campos_editados: camposEditados,
      campos_confirmados: camposConfirmados,
      campos_nao_alterados: camposAchados.length + 2 - camposEditados.length - camposConfirmados.length,
      detalhes: detalhes
    },
    achados_radiograficos: updatePayload.achados_radiograficos,
    impressao_radiografica: updatePayload.impressao_radiografica,
    recomendacoes_orthox: updatePayload.recomendacoes_orthox
  };
}

// ── Enviar dados de aprovação para o n8n (fire-and-forget) ─────
function dispararWebhookAprovacao(payload) {
  fetch(CFG.webhookAprovacao, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(function() {
    // Silencioso — não bloqueia a UI se o webhook falhar
  });
}

// ── Finalizar laudo (novo botão unificado) ────────────────────
async function finalizarLaudo(id) {
  const btnEl = document.getElementById('btn-final-' + id);
  const l = window.laudosDict[id];
  const v = window.blocosVals[id] || {};
  const limpar = t => typeof t === 'string' ? t.replace(/[\u2022\u2023\u25E6\u2043\u2219]/g,'').trim() : t;

  let denticaoText = (v.denticao_ausencias || '').replace(/\[ATENÇÃO DRA.*?\]/g,'').trim();

  const pacote = {
    laudo_id: id,
    nomePaciente: l.nome_paciente,
    osNum: l.os,
    dentista: l.dentista,
    dataExame: l.data_exame,
    tipoExame: l.tipo_exame,
    dataNasc: l.data_nasc,
    sexo: l.sexo,
    queixa: l.queixa,
    nivel_dificuldade: l.nivel_dificuldade,
    imagem_url: l.imagem_url || '',
    achados_radiograficos: {
      denticao_ausencias:                    denticaoText,
      reabilitacoes_implantes:               v.reabilitacoes_implantes || '',
      tratamentos_endodonticos_restauracoes: v.tratamentos_endodonticos_restauracoes || '',
      avaliacao_ossea_periodontal:           v.avaliacao_ossea_periodontal || '',
      seios_maxilares_estruturas_adjacentes: v.seios_maxilares_estruturas_adjacentes || '',
    },
    impressao_radiografica: (v._impressao || '').split('\n').map(limpar).filter(x => x),
    recomendacoes_orthox:   (v._recomendacoes || '').split('\n').map(limpar).filter(x => x),
  };

  // FIX 2026-05-27 (Issue #3): persistir via Supabase PATCH ao invés de webhook inexistente.
  // PDF original mantido; edições de texto são salvas direto no banco.
  btnEl.disabled = true;
  const textoOriginal = btnEl.innerHTML;
  btnEl.innerHTML = 'Salvando...';
  window.aprovadosEm[id] = Date.now();

  try {
    const updatePayload = {
      status: 'Aprovado',
      achados_radiograficos: pacote.achados_radiograficos,
      impressao_radiografica: pacote.impressao_radiografica,
      recomendacoes_orthox: pacote.recomendacoes_orthox,
      validado_em: new Date().toISOString()
    };

    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/${CFG.tabela}?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': CFG.supabaseKey,
        'Authorization': 'Bearer ' + CFG.supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('Falha ao salvar (HTTP ' + res.status + '): ' + (errText || res.statusText));
    }

    const updated = await res.json().catch(() => null);
    if (!Array.isArray(updated) || updated.length === 0) {
      throw new Error('Edições não confirmadas pelo banco — registro não encontrado.');
    }

    buscarValidacoes();
    buscarLaudos();

    // Disparar webhook de aprovação para coleta de feedback qualitativo
    const payloadAprov = montarPayloadAprovacao(id, l, updatePayload);
    dispararWebhookAprovacao(payloadAprov);
  } catch (err) {
    alert('Erro ao processar: ' + err.message);
    btnEl.disabled = false;
    btnEl.innerHTML = textoOriginal;
  }
}


/* ══════════════════════════════
   LÓGICA DO ODONTOGRAMA VISUAL
══════════════════════════════ */
function inicializarOdontograma(id) {
  const quadrantes = {
    'q1': [18,17,16,15,14,13,12,11],
    'q2': [21,22,23,24,25,26,27,28],
    'q3': [38,37,36,35,34,33,32,31],
    'q4': [48,47,46,45,44,43,42,41]
  };

  const confirmados = new Set();
  const divergentes = new Set();
  const l = window.laudosDict[id];

  let achados = l.achados_radiograficos || {};
  if (typeof achados === 'string') { try { achados = JSON.parse(achados); } catch(e) { achados = {}; } }
  
  const textoDenticao = achados.denticao_ausencias || '';

  // Procura no texto original quais estão confirmados ou divergentes
  // Tenta padrão 1: "confirmadas por dupla análise: 18, 28..."
const matchConf = textoDenticao.match(/confirmad[aoe\s]+[^:]*:\s*([\d,\s.eE]+)/i);
if (matchConf) {
  matchConf[1].match(/\b(\d{2})\b/g)?.forEach(n => {
    const num = parseInt(n);
    if (num >= 11 && num <= 48) confirmados.add(num);
  });
}

// Tenta padrão 2: "elementos 18, 28, 38 e 48" (formato do Redator)
if (confirmados.size === 0) {
  const matchElem = textoDenticao.match(/elementos?\s+([\d,\s.eE]+)/i);
  if (matchElem) {
    matchElem[1].match(/\b(\d{2})\b/g)?.forEach(n => {
      const num = parseInt(n);
      if (num >= 11 && num <= 48) confirmados.add(num);
    });
  }
}

// Tenta padrão 3: "Checar clinicamente: 18, 28..." (divergências)
const matchDiv = textoDenticao.match(/[Cc]hecar clinicamente[^:]*:\s*([\d,\s.eE]+)/);
if (matchDiv) {
  matchDiv[1].match(/\b(\d{2})\b/g)?.forEach(n => {
    const num = parseInt(n);
    if (num >= 11 && num <= 48) divergentes.add(num);
  });
}

// Fallback geral
if (confirmados.size === 0 && divergentes.size === 0) {
  const rowEl = document.getElementById('valrow-' + id);
  const textoTela = rowEl?.querySelector('.val-alert-text')?.textContent || '';
  textoTela.match(/\b(\d{2})\b/g)?.forEach(n => {
    const num = parseInt(n);
    if (num >= 11 && num <= 48) divergentes.add(num);
  });
}

  window.odontogramaState[id] = new Set([...confirmados]);

  for (const [qid, dentes] of Object.entries(quadrantes)) {
    const container = document.getElementById(qid + '-' + id);
    if (!container) continue;
    container.innerHTML = '';
    
    dentes.forEach(num => {
      const btn = document.createElement('button');
      btn.className = 'dente-btn';
      btn.dataset.dente = num;

      const isConfirmado = confirmados.has(num);
      const isDivergente = divergentes.has(num);

      if (isConfirmado) {
        btn.classList.add('ja-confirmado');
        btn.title = 'Ausência confirmada pela IA';
        // Se ela clicar num já confirmado, ele também desmarca
        btn.addEventListener('click', () => toggleDente(id, num, btn));
      } else if (isDivergente) {
        btn.classList.add('ausente');
        window.odontogramaState[id].add(num);
        btn.title = 'Em divergência — clique para remover se o dente estiver presente';
        btn.addEventListener('click', () => toggleDente(id, num, btn));
      } else {
        btn.title = 'Clique para marcar como ausente';
        btn.addEventListener('click', () => toggleDente(id, num, btn));
      }

      btn.innerHTML = '<span class="dente-ico">🦷</span><span class="dente-num">' + num + '</span>';
      container.appendChild(btn);
    });
  }
}

function toggleDente(id, num, btn) {
  if (!window.odontogramaState[id]) window.odontogramaState[id] = new Set();
  
  if (window.odontogramaState[id].has(num)) {
    window.odontogramaState[id].delete(num);
    btn.classList.remove('ausente');
    btn.classList.remove('ja-confirmado'); // Remove verde se a doutora disser que o dente existe
  } else {
    window.odontogramaState[id].add(num);
    btn.classList.add('ausente');
  }
  
  atualizarTextoDenticao(id);
}

function atualizarTextoDenticao(id) {
  // No novo sistema de blocos o ID é bloco-ta-{id}-denticao
  const textarea = document.getElementById('bloco-ta-' + id + '-denticao');
  if (!textarea) return;
  const ausentes = [...window.odontogramaState[id]].sort((a,b) => a-b);
  if (ausentes.length === 0) {
    textarea.value = 'Dentição permanente. Sem evidências radiográficas de ausências dentárias.';
  } else {
    textarea.value = 'Observa-se a ausência das imagens radiográficas correspondentes aos elementos dentários ' + ausentes.join(', ') + '.';
  }
  // Sincroniza com blocosVals para o preview
  if (window.blocosVals && window.blocosVals[id]) {
    window.blocosVals[id]['denticao_ausencias'] = textarea.value;
    atualizarPreview(id);
  }
}


/* ══════════════════════════════
   INTERAÇÃO E ENVIO WEBHOOK 2
══════════════════════════════ */

// 1. Aprovação direta (atualiza Supabase diretamente, sem regenerar PDF)
// FIX 2026-05-27 (Issue #3): aprovação via PATCH Supabase ao invés de webhook inexistente
async function aprovarSemEditar(id) {
    const btnEl = document.getElementById('btnaprovar-' + id);
    const l = window.laudosDict[id];

    // Função que arranca os bullets (pontinhos) problemáticos
    const limparBullet = (texto) => typeof texto === 'string' ? texto.replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '').trim() : texto;

    let achados = l.achados_radiograficos;
    if (typeof achados === 'string') { try { achados = JSON.parse(achados); } catch(e) { achados = {}; } }

    // Ocultar alertas [ATENÇÃO DRA] do texto original
    if (achados.denticao_ausencias) {
        achados.denticao_ausencias = achados.denticao_ausencias.replace(/\[ATENÇÃO DRA.*?\]/g, '').trim();
    }

    let imp = l.impressao_radiografica;
    if (typeof imp === 'string') { try { imp = JSON.parse(imp); } catch(e) { imp = [imp]; } }
    if (Array.isArray(imp)) imp = imp.map(limparBullet);

    let rec = l.recomendacoes_orthox;
    if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch(e) { rec = [rec]; } }
    if (Array.isArray(rec)) rec = rec.map(limparBullet);

    btnEl.disabled = true;
    const textoOriginal = btnEl.innerHTML;
    btnEl.innerHTML = 'Aprovando...';
    window.aprovadosEm[id] = Date.now();

    try {
        const updatePayload = {
            status: 'Aprovado',
            achados_radiograficos: achados,
            impressao_radiografica: imp,
            recomendacoes_orthox: rec,
            validado_em: new Date().toISOString()
        };

        const res = await fetch(`${CFG.supabaseUrl}/rest/v1/${CFG.tabela}?id=eq.${id}`, {
            method: 'PATCH',
            headers: {
                'apikey': CFG.supabaseKey,
                'Authorization': 'Bearer ' + CFG.supabaseKey,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(updatePayload)
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error('Falha na aprovação (HTTP ' + res.status + '): ' + (errText || res.statusText));
        }

        const updated = await res.json().catch(() => null);
        if (!Array.isArray(updated) || updated.length === 0) {
            throw new Error('Aprovação não confirmada pelo banco — registro não encontrado.');
        }

        buscarValidacoes();
        buscarLaudos();

        // Disparar webhook de aprovação (fire-and-forget)
        var payloadAprov2 = montarPayloadAprovacao(id, l, updatePayload);
        dispararWebhookAprovacao(payloadAprov2);
    } catch (err) {
        alert('Erro ao processar: ' + err.message);
        btnEl.disabled = false;
        btnEl.innerHTML = textoOriginal;
    }
}


// Função central que empacota e envia para o Webhook 2 (Seguro)
async function dispararWebhookReprint(id, payload, btnEl, loadingText) {
    btnEl.disabled = true;
    const textoOriginal = btnEl.innerHTML;
    btnEl.innerHTML = loadingText;
    window.aprovadosEm[id] = Date.now(); 

    try {
        const res = await fetch(CFG.webhookReprint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-orthox-token': CFG.orthoXToken
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Erro na comunicação com o servidor n8n');

        buscarValidacoes();
        buscarLaudos();
    } catch (err) {
        alert('Erro ao processar: ' + err.message);
        btnEl.disabled = false;
        btnEl.innerHTML = textoOriginal;
    }
}


function renderArtefatosBlock(l) {
  const hasV63 = (l.artefatos && Array.isArray(l.artefatos) && l.artefatos.length > 0) || l.drive_folder_url;
  if (!hasV63) return '';

  const dur = (typeof l.processamento_duracao_segundos === 'number')
    ? `<span class="laudo-v63-stat">⏱️ <strong>${l.processamento_duracao_segundos.toFixed(0)}s</strong></span>`
    : '';
  const countArt = Array.isArray(l.artefatos) ? l.artefatos.length : 0;
  const stat = countArt > 0
    ? `<span class="laudo-v63-stat">📦 <strong>${countArt}</strong> artefatos</span>`
    : '';
  const folder = l.drive_folder_url
    ? `<a class="laudo-drive-btn" href="${esc(l.drive_folder_url)}" target="_blank" rel="noopener">📁 Pasta Drive</a>`
    : '';

  let gridHtml = '';
  if (countArt > 0) {
    gridHtml = '<div class="laudo-artefatos" style="margin-top:8px">';
    l.artefatos.slice(0, 9).forEach(art => {
      const ordem = (art && (art.ordem != null)) ? `#${art.ordem} ` : '';
      const nome = esc((art && art.nome) || 'Artefato');
      const url = (art && art.url) || (art && art.drive_file_id ? `https://drive.google.com/file/d/${art.drive_file_id}/view` : '');
      if (!url) return;
      gridHtml += `<a class="laudo-art" href="${esc(url)}" target="_blank" rel="noopener" title="${esc((art && art.descricao) || '')}">${ordem}${nome}</a>`;
    });
    gridHtml += '</div>';
  }

  return `
      <details class="laudo-v63-block" style="margin-top:10px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <summary style="cursor:pointer;display:flex;align-items:center;gap:12px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.05em;color:var(--text-2)">
          <strong style="color:var(--text)">Artefatos de Análise</strong>
          ${stat}
          ${dur}
          ${folder}
        </summary>
        ${gridHtml}
      </details>
  `;
}
function renderValidacoes(lista) {
  const el = document.getElementById('valList');
  const pendentes = lista.filter(l => precisaValidacao(l));
  const aprovados  = lista.filter(l => l.status === 'Aprovado').slice(0, 3);

  document.getElementById('valPollStatus').textContent =
    pendentes.length > 0 ? `${pendentes.length} laudo(s) aguardando validação` : 'Nenhum laudo pendente';

  const todos = [...pendentes, ...aprovados];
  if (todos.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Todos os laudos aprovados</div><div class="empty-sub">Não há laudos pendentes de validação</div></div>`;
    return;
  }

  window.laudosDict = {};
  el.innerHTML = todos.map(l => {
    window.laudosDict[l.id] = l;
    if (!window.blocosState[l.id]) window.blocosState[l.id] = {};
    if (!window.blocosOpen[l.id])  window.blocosOpen[l.id]  = new Set();

    const aprovado = l.status === 'Aprovado';
    const dt = l.created_at ? new Date(l.created_at).toLocaleString('pt-BR') : '—';
    const divergencia = extrairDivergencia(l);

    return `
    <div class="val-row ${aprovado ? 'aprovado' : ''}" id="valrow-${esc(l.id)}">
      <div class="val-row-header">
        <div>
          <div class="val-paciente">${esc(l.nome_paciente || 'Paciente')}</div>
          <div class="val-meta">
            <span class="val-chip">OS <span>${esc(l.os || '—')}</span></span>
            <span class="val-chip">Tipo <span>${esc(l.tipo_exame || '—')}</span></span>
            <span class="val-chip">Doutor(a) <span>${esc(l.dentista || '—')}</span></span>
            <span class="val-chip">Gerado em <span>${dt}</span></span>
            ${l.score_concordancia != null ? `<span class="val-chip">Score <span style="color:${l.score_concordancia >= 80 ? 'var(--success-text)' : 'var(--warning-text)'}">${l.score_concordancia >= 80 ? '✓ ' : '⚠ '}${l.score_concordancia}</span></span>` : ''}
          </div>
        </div>
        ${aprovado
          ? `<span class="val-status-aprovado">✓ APROVADO</span>`
          : `<span style="font-family:'DM Mono',monospace;font-size:9px;background:var(--warning-border);color:#fff;padding:4px 10px;border-radius:3px;letter-spacing:.06em">⚠ PENDENTE</span>`}
      </div>

      <div class="val-alert">
        <strong>${aprovado ? '✓ Validação concluída' : '⚠ Atenção — Revisão necessária'}</strong>
        <span class="val-alert-text">${esc(divergencia)}</span>
      </div>

      ${renderArtefatosBlock(l)}

      ${aprovado ? `
        <div class="val-actions">
          <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--success-text)">✓ Laudo validado e liberado para o solicitante</span>
          ${l.pdf_url && l.pdf_url !== 'Aguardando Validação' ? `<a class="btn-ver-pdf" href="${esc(l.pdf_url)}" target="_blank">📄 Ver PDF</a>` : ''}
        </div>
      ` : `
        <div id="editor-wrap-${esc(l.id)}" style="display:none">
          <div class="val-progress-bar">
            <div class="val-progress-steps" id="progress-steps-${esc(l.id)}"></div>
            <span class="val-progress-label" id="progress-label-${esc(l.id)}">0 / ${BLOCOS_DEF.length}</span>
          </div>
          <div class="val-editor-wrap">
            <div class="val-blocos" id="blocos-${esc(l.id)}"></div>
            <div class="val-preview-panel">
              <div class="val-preview-header">
                <span class="val-preview-label">Preview do PDF</span>
                <span class="val-preview-badge">Ao vivo</span>
              </div>
              <iframe id="preview-frame-${esc(l.id)}" class="val-preview-scale" scrolling="yes"></iframe>
            </div>
          </div>
          <div style="padding:0 0 16px">
            <button class="btn-aprovar-final" id="btn-final-${esc(l.id)}" disabled onclick="finalizarLaudo('${esc(l.id)}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Aprovar e Gerar PDF
            </button>
            <div class="btn-aprovar-pendente-msg" id="msg-final-${esc(l.id)}">Revise todos os blocos para liberar</div>
          </div>
        </div>
        <div class="val-actions" id="actions-${esc(l.id)}">
          <button class="btn-aprovar" onclick="aprovarSemEditar('${esc(l.id)}')" id="btnaprovar-${esc(l.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Aprovar sem editar
          </button>
          <button class="btn-corrigir" onclick="abrirEditor('${esc(l.id)}')">
            ✏️ Revisar com Editor
          </button>
          ${l.pdf_url && l.pdf_url !== 'Aguardando Validação' ? `<a class="btn-ver-pdf" href="${esc(l.pdf_url)}" target="_blank">📄 Ver PDF</a>` : ''}
        </div>
      `}
    </div>`;
  }).join('');
}
function abrirEditor(id) {
  const l = window.laudosDict[id];
  document.getElementById('actions-' + id).style.display = 'none';
  document.getElementById('editor-wrap-' + id).style.display = 'block';

  let achados = l.achados_radiograficos || {};
  if (typeof achados === 'string') { try { achados = JSON.parse(achados); } catch(e) { achados = {}; } }

  let imp = l.impressao_radiografica || [];
  if (typeof imp === 'string') { try { imp = JSON.parse(imp); } catch(e) { imp = [imp]; } }
  const impStr = Array.isArray(imp) ? imp.join('\n') : imp;

  let rec = l.recomendacoes_orthox || [];
  if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch(e) { rec = [rec]; } }
  const recStr = Array.isArray(rec) ? rec.join('\n') : rec;

  // Valores iniciais por campo
  const vals = {
    denticao_ausencias:                   achados.denticao_ausencias || '',
    reabilitacoes_implantes:              achados.reabilitacoes_implantes || '',
    tratamentos_endodonticos_restauracoes: achados.tratamentos_endodonticos_restauracoes || '',
    avaliacao_ossea_periodontal:          achados.avaliacao_ossea_periodontal || '',
    seios_maxilares_estruturas_adjacentes: achados.seios_maxilares_estruturas_adjacentes || '',
    _impressao:    impStr,
    _recomendacoes: recStr,
  };

  window.blocosVals = window.blocosVals || {};
  window.blocosVals[id] = { ...vals };

  const container = document.getElementById('blocos-' + id);
  container.innerHTML = '';

  // ── IMAGEM ORIGINAL ─────────────────────────────────────
  if (l.imagem_url) {
    const imgWrap = document.createElement('div');
    imgWrap.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:12px;background:#111;';
    imgWrap.innerHTML = `
      <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);padding:8px 12px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
        <span>Radiografia Original</span>
        <a href="${l.imagem_url}" target="_blank" style="font-size:9px;color:var(--red-mid);text-decoration:none;font-weight:600;letter-spacing:.05em;">Abrir em tela cheia ↗</a>
      </div>
      <img src="${l.imagem_url}"
        style="width:100%;max-height:300px;object-fit:contain;display:block;background:#111;cursor:zoom-in;"
        onclick="window.open('${l.imagem_url}','_blank')"
        onerror="this.closest('div').style.display='none'"
        alt="Radiografia">
    `;
    container.appendChild(imgWrap);
  }
  // ── FIM DA IMAGEM ───────────────────────────────────────

  BLOCOS_DEF.forEach(def => {
    const estado = window.blocosState[id][def.key] || 'pendente';
    const val = vals[def.campo] || '';
    const isEmpty = !val.trim();
    const badgeTexto = { pendente: 'Pendente', confirmado: '✓ OK', editado: '✏ Editado' }[estado];

    const bloco = document.createElement('div');
    // Bloco de dentição começa aberto para o odontograma ser visível de imediato
    const abrirInicio = def.key === 'denticao';
    bloco.className = `bloco ${estado}${abrirInicio ? ' open' : ''}`;
    bloco.id = `bloco-${id}-${def.key}`;

    // Header clicável
    bloco.innerHTML = `
      <div class="bloco-header" onclick="toggleBloco('${id}','${def.key}')">
        <div class="bloco-status-dot"></div>
        <span class="bloco-titulo">${def.titulo}</span>
        ${isEmpty ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--text-3);padding:2px 7px;border-radius:3px;background:var(--surface2)">vazio</span>` : `<span class="bloco-badge">${badgeTexto}</span>`}
        <span class="bloco-chevron">▼</span>
      </div>
      <div class="bloco-body">
        ${def.temOdonto ? `
          <div class="odontograma-wrap" style="margin-bottom:12px">
            <div class="odonto-instrucao" style="font-size:12px;margin-bottom:10px">
              <strong>✅ Verde</strong> = confirmado pela IA &nbsp;·&nbsp; <strong style="color:var(--warning-text)">⚠ Amarelo</strong> = divergência &nbsp;·&nbsp; <strong>Branco</strong> = presente
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div><div class="odonto-arcada-label">Superior direito</div><div class="odonto-row" id="q1-${id}"></div></div>
              <div><div class="odonto-arcada-label">Superior esquerdo</div><div class="odonto-row" id="q2-${id}"></div></div>
              <div><div class="odonto-arcada-label">Inferior esquerdo</div><div class="odonto-row" id="q3-${id}"></div></div>
              <div><div class="odonto-arcada-label">Inferior direito</div><div class="odonto-row" id="q4-${id}"></div></div>
            </div>
          </div>
        ` : ''}
        <textarea id="bloco-ta-${id}-${def.key}" rows="${def.key === 'impressao' || def.key === 'rec' ? 5 : 3}"
          oninput="onBlocoInput('${id}','${def.key}')">${escHtml(val)}</textarea>
        <div class="bloco-actions">
          <button class="btn-bloco-confirmar" id="btn-confirm-${id}-${def.key}" onclick="confirmarBloco('${id}','${def.key}')">${estado === 'editado' ? '✓ Confirmar alteração' : '✓ Confirmar'}</button>
        </div>
      </div>`;

    container.appendChild(bloco);

    // Odontograma inicializado no toggleBloco, quando o DOM já existe
  });

  atualizarProgressBar(id);
  atualizarPreview(id);
  // Inicializa odontograma agora que o bloco de dentição já está aberto no DOM
  setTimeout(() => {
    if (!odontogramaState[id]) inicializarOdontograma(id);
  }, 0);
}
function toggleBloco(id, key) {
  const bloco = document.getElementById(`bloco-${id}-${key}`);
  bloco.classList.toggle('open');
  // Inicializa odontograma ao abrir o bloco de dentição (DOM já existe)
  if (key === 'denticao' && bloco.classList.contains('open') && !odontogramaState[id]) {
    inicializarOdontograma(id);
  }
}
function onBlocoInput(id, key) {
  const ta = document.getElementById(`bloco-ta-${id}-${key}`);
  if (!window.blocosVals[id]) window.blocosVals[id] = {};
  const def = BLOCOS_DEF.find(d => d.key === key);
  window.blocosVals[id][def.campo] = ta.value;
  // Marca como editado ao digitar — botão muda para "confirmar alteração"
  setEstadoBloco(id, key, 'editado');
  atualizarPreview(id);
  atualizarProgressBar(id);
}
function confirmarBloco(id, key) {
  setEstadoBloco(id, key, 'confirmado');
  // Fecha o bloco após confirmar
  const bloco = document.getElementById(`bloco-${id}-${key}`);
  bloco.classList.remove('open');
  atualizarProgressBar(id);
  atualizarPreview(id);
}
function editarBloco(id, key) {
  setEstadoBloco(id, key, 'editado');
  atualizarProgressBar(id);
  atualizarPreview(id);
}
function setEstadoBloco(id, key, estado) {
  if (!window.blocosState[id]) window.blocosState[id] = {};
  window.blocosState[id][key] = estado;
  const bloco = document.getElementById(`bloco-${id}-${key}`);
  if (!bloco) return;
  bloco.classList.remove('pendente','confirmado','editado');
  bloco.classList.add(estado);
  const badgeMap = { pendente:'Pendente', confirmado:'✓ OK', editado:'✏ Editado' };
  const badgeEl = bloco.querySelector('.bloco-badge');
  if (badgeEl) badgeEl.textContent = badgeMap[estado];
  // Atualiza texto do botão confirmar baseado no estado
  const btnConfirm = document.getElementById('btn-confirm-' + id + '-' + key);
  if (btnConfirm) btnConfirm.textContent = estado === 'editado' ? '✓ Confirmar alteração' : '✓ Confirmar';
}
function atualizarProgressBar(id) {
  const estado = window.blocosState[id] || {};
  const total = BLOCOS_DEF.length;
  let feitos = 0;
  const stepsEl = document.getElementById('progress-steps-' + id);
  const labelEl = document.getElementById('progress-label-' + id);
  const btnFinal = document.getElementById('btn-final-' + id);
  const msgFinal = document.getElementById('msg-final-' + id);
  if (!stepsEl) return;

  stepsEl.innerHTML = BLOCOS_DEF.map(def => {
    const e = estado[def.key] || 'pendente';
    if (e === 'confirmado') feitos++;
    return `<div class="val-progress-step ${e === 'confirmado' ? 'done' : e === 'editado' ? 'edited' : ''}"></div>`;
  }).join('');

  if (labelEl) labelEl.textContent = `${feitos} / ${total}`;

  if (btnFinal) {
    const tudo = feitos === total;
    btnFinal.disabled = !tudo;
    if (msgFinal) msgFinal.style.display = tudo ? 'none' : 'block';
  }
}
function atualizarPreview(id) {
  const l = window.laudosDict[id];
  if (!l) return;
  const v = window.blocosVals[id] || {};

  const achados = {
    denticao_ausencias:                    v.denticao_ausencias || '',
    reabilitacoes_implantes:               v.reabilitacoes_implantes || '',
    tratamentos_endodonticos_restauracoes: v.tratamentos_endodonticos_restauracoes || '',
    avaliacao_ossea_periodontal:           v.avaliacao_ossea_periodontal || '',
    seios_maxilares_estruturas_adjacentes: v.seios_maxilares_estruturas_adjacentes || '',
  };

  const impArr = (v._impressao || '').split('\n').filter(x => x.trim());
  const recArr = (v._recomendacoes || '').split('\n').filter(x => x.trim());

  const subsecMap = {
    denticao_ausencias:                    'Dentição e Ausências',
    reabilitacoes_implantes:               'Reabilitações e Implantes',
    tratamentos_endodonticos_restauracoes: 'Tratamentos Endodônticos e Restaurações',
    avaliacao_ossea_periodontal:           'Avaliação Óssea e Periodontal',
    seios_maxilares_estruturas_adjacentes: 'Seios Maxilares e Estruturas Adjacentes',
  };

  const achadosHtml = Object.entries(achados)
    .filter(([,v]) => v.trim())
    .map(([k,v]) => `<div class="sub"><div class="subt">${subsecMap[k]}</div><div class="subc">${escHtml(v)}</div></div>`)
    .join('');

  const queixaBlock = l.queixa ? `<div class="pf pff"><span class="lbl">Queixa</span><span class="val">${escHtml(l.queixa)}</span></div>` : '';

  const radiografiaBlock = l.imagem_url
    ? `<div class="rx-wrap"><img class="rx-img" src="${escHtml(l.imagem_url)}" alt="Radiografia Original"><div class="rx-caption">Radiografia Panor&acirc;mica &mdash; Imagem Original do Exame</div></div>`
    : '';
  const tipoExameMap = { panoramica: 'Radiografia Panorâmica', periapical: 'Radiografia Periapical', interproximal: 'Radiografia Interproximal' };
  const tipoExame = tipoExameMap[l.tipo_exame] || (l.tipo_exame || 'Radiografia Panorâmica');

  let html = PDF_TEMPLATE
    .replace(/{{OS}}/g, escHtml(l.os || '—'))
    .replace('{{LOGO_URL}}',   'https://tech-emn.github.io/orthox/assets/orthox-logo-oficial.webp?v=20260527')
    .replace('{{PACIENTE}}',   escHtml(l.nome_paciente || '—'))
    .replace('{{DATA_EXAME}}', escHtml(l.data_exame || '—'))
    .replace('{{DENTISTA}}',   escHtml(l.dentista || '—'))
    .replace('{{DATA_NASC}}',  escHtml(l.data_nasc || '—'))
    .replace('{{SEXO}}',       escHtml(l.sexo || '—'))
    .replace('{{TIPO_EXAME}}', escHtml(tipoExame))
    .replace('{{QUEIXA_BLOCK}}',     queixaBlock)
    .replace('{{RADIOGRAFIA_BLOCK}}', radiografiaBlock)
    .replace('{{ACHADOS_BLOCKS}}', achadosHtml)
    .replace('{{IMP_ITEMS}}',  impArr.map(i => `<li>${escHtml(i)}</li>`).join(''))
    .replace('{{REC_ITEMS}}',  recArr.map(i => `<li>${escHtml(i)}</li>`).join(''));

  const frame = document.getElementById('preview-frame-' + id);
  if (!frame) return;
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
}
function loadChartJS(cb) {
  if (window.Chart) return cb();
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.onload = cb;
  document.head.appendChild(s);
}

export { abrirEditor, aprovarSemEditar, atualizarPreview, atualizarProgressBar, atualizarTextoDenticao, buscarValidacoes, confirmarBloco, dispararWebhookAprovacao, dispararWebhookReprint, editarBloco, finalizarLaudo, inicializarOdontograma, loadChartJS, montarPayloadAprovacao, onBlocoInput, renderArtefatosBlock, renderValidacoes, setEstadoBloco, toggleBloco, toggleDente };
