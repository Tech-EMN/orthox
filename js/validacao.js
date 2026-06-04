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


export { buscarValidacoes, renderValidacoes, renderArtefatosBlock, abrirEditor, toggleBloco, onBlocoInput, confirmarBloco, editarBloco, setEstadoBloco, atualizarProgressBar, atualizarPreview, montarPayloadAprovacao, dispararWebhookAprovacao, finalizarLaudo, inicializarOdontograma, toggleDente, atualizarTextoDenticao, aprovarSemEditar, dispararWebhookReprint, loadChartJS };
