import CFG from './config.js';

window.selectedFile = null;
window.pollTimer    = null;
window.countInt     = null;
window.countVal     = window.CFG.pollSeg;
window.vistos       = new Set();
window.novosPend    = 0;
window.valPend      = 0;
window.vistosVal    = new Set();
window.aprovadosEm = {}; 
window.odontogramaState = {}; // Guarda o estado dos dentes para cada laudo

// Dicionário Global para armazenar os dados crus que vêm do banco
window.laudosDict = {};


/* ── TABS ── */
function switchTab(nome, btn) {
  // Deactivate all panels and buttons
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  // Activate selected panel and button
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('panel-' + nome);
  if (panel) panel.classList.add('active');
  // Tab-specific initialization
  if (nome === 'laudos') {
    window.novosPend = 0; atualizarNotif();
    if (!window.pollTimer) iniciarPolling();
  }
  if (nome === 'validacao') {
    window.valPend = 0; atualizarValNotif();
    buscarValidacoes();
  }
  if (nome === 'dashboard') {
    initDashboard();
  }
}

/* ── READOUT ── */
function atualizarReadout() {
  const nome    = document.getElementById('nomePaciente').value.trim();
  const nascRaw = document.getElementById('dataNasc').value;
  const sexo    = document.getElementById('sexo').value;
  const os      = document.getElementById('osNum').value.trim();
  const dataEx  = document.getElementById('dataExame').value;
  document.getElementById('dispNome').textContent = nome || '—';
  if (nascRaw) {
    const nasc = new Date(nascRaw + 'T00:00:00');
    const hoje = new Date();
    let a = hoje.getFullYear() - nasc.getFullYear();
    let m = hoje.getMonth() - nasc.getMonth();
    if (m < 0) { a--; m += 12; }
    document.getElementById('dispNasc').textContent =
      `${nasc.toLocaleDateString('pt-BR')} [${a}a. ${m}m]${sexo ? ' · ' + sexo : ''}`;
  } else {
    document.getElementById('dispNasc').textContent = '—';
  }
  const df = dataEx ? new Date(dataEx + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
  document.getElementById('dispOS').textContent = `${os ? 'OS: ' + os : '—'} · ${df}`;
}

/* ── DRAG & DROP ── */
const zone = document.getElementById('uploadZone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
zone.addEventListener('drop', e => {
  e.preventDefault(); zone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
});
function handleFile(i) { if (i.files[0]) processFile(i.files[0]); }
function processFile(file) {
  window.selectedFile = file;
  document.getElementById('previewName').textContent = file.name;
  if (file.type.startsWith('image/')) {
    const r = new FileReader();
    r.onload = e => {
      document.getElementById('previewImg').src = e.target.result;
      document.getElementById('previewWrap').style.display = 'block';
    };
    r.readAsDataURL(file);
  } else {
    document.getElementById('previewWrap').style.display = 'none';
  }
  document.getElementById('btnSubmit').disabled = false;
  hideError();
}

/* ── ENVIO (WEBHOOK 1) ── */
async function enviar() {
  if (!window.selectedFile) { showError('Selecione uma imagem antes de enviar.'); return; }
  if (window.ENVIANDO) { showError('Um envio ja esta em andamento. Aguarde.'); return; }
  window.ENVIANDO = true;

  const nomePaciente = document.getElementById('nomePaciente').value.trim();
  const dataNasc     = document.getElementById('dataNasc').value;
  const sexo         = document.getElementById('sexo').value;
  if (!nomePaciente) { showError('Preencha o nome do paciente antes de enviar.'); return; }
  if (!dataNasc)     { showError('Preencha a data de nascimento.'); return; }
  if (!sexo)         { showError('Selecione o sexo do paciente.'); return; }

  // Bloquear TODOS os campos durante o envio
  var formInputs = document.querySelectorAll('#panel-envio input, #panel-envio textarea, #panel-envio select, #panel-envio button');
  formInputs.forEach(function(el) { el.disabled = true; });
  var uploadZone = document.getElementById('uploadZone');
  if (uploadZone) uploadZone.style.pointerEvents = 'none';
  
  var btn = document.getElementById('btnSubmit');
  btn.textContent = 'Comprimindo imagem...';
  btn.style.background = '#1a3a2a';
  hideError();

  try {
    // === PASSO 1: Comprimir imagem via canvas ===
    var img = new Image();
    var objectUrl = URL.createObjectURL(window.selectedFile);
    
    img.onload = async function() {
      URL.revokeObjectURL(objectUrl);
      
      // Canvas para compressão — máximo 1200px de largura, JPEG 80% qualidade
      var canvas = document.createElement('canvas');
      var MAX_W = 1200;
      var scale = img.width > MAX_W ? MAX_W / img.width : 1;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Comprimir para JPEG (formato universal para radiografias)
      var compressedDataUrl = canvas.toDataURL('image/jpeg', 0.80);
      var imageBase64 = compressedDataUrl.split(',')[1];
      
      // Mostrar info de compressão
      var originalKB = (window.selectedFile.size / 1024).toFixed(0);
      var compressedKB = (imageBase64.length * 0.75 / 1024).toFixed(0);
      btn.textContent = 'Enviando (' + compressedKB + ' KB)...';
      
      // === PASSO 2: Enviar como JSON ===
      var payload = {
        nomePaciente: nomePaciente,
        dataNasc: dataNasc,
        sexo: sexo,
        osNum: document.getElementById('osNum').value || 'OS-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        dentista: document.getElementById('dentista').value || '',
        dataExame: document.getElementById('dataExame').value || '',
        tipoExame: document.getElementById('tipoExame').value || 'panoramica',
        queixa: document.getElementById('queixa').value || '',
        image_base64: imageBase64,
        timestamp: new Date().toISOString()
      };
      
      try {
        var res = await fetch(CFG.webhookEnvio, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-orthox-token': CFG.orthoXToken
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          var errText = await res.text();
          throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.substring(0, 200) : ''));
        }
        mostrarToast(); resetForm();
        
        // Feedback visual: mostrar 'Enviado!' por 2s
        btn.textContent = '✅ Enviado!';
        btn.style.background = '#16A34A';
        await new Promise(function(r) { setTimeout(r, 2000); });
        
      } catch (err) {
        showError('Falha no envio: ' + (err.message || 'verifique a conexão com o servidor'));
      } finally {
        // Desbloquear campos
        formInputs.forEach(function(el) { el.disabled = false; });
        if (uploadZone) uploadZone.style.pointerEvents = '';
        btn.style.background = '';
        btn.textContent = 'Enviar para Análise IA →';
        window.ENVIANDO = false;
      }
    };
    
    img.onerror = function() {
      URL.revokeObjectURL(objectUrl);
      showError('Erro ao processar a imagem. Verifique o formato do arquivo.');
      formInputs.forEach(function(el) { el.disabled = false; });
      if (uploadZone) uploadZone.style.pointerEvents = '';
      btn.style.background = '';
      btn.textContent = 'Enviar para Análise IA →';
      window.ENVIANDO = false;
    };
    
    // Iniciar carregamento da imagem
    img.src = objectUrl;
    
  } catch (err) {
    showError('Erro ao processar imagem: ' + (err.message || 'desconhecido'));
    formInputs.forEach(function(el) { el.disabled = false; });
    if (uploadZone) uploadZone.style.pointerEvents = '';
    btn.style.background = '';
    btn.textContent = 'Enviar para Análise IA →';
    window.ENVIANDO = false;
  }
}

function mostrarToast() {
  const t = document.getElementById('toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 7000);
}

function resetForm() {
  ['nomePaciente','dataNasc','osNum','dentista','queixa'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('sexo').selectedIndex = 0;
  document.getElementById('tipoExame').selectedIndex = 0;
  document.getElementById('fileInput').value = '';
  document.getElementById('previewWrap').style.display = 'none';
  document.getElementById('btnSubmit').disabled = true;
  window.selectedFile = null;
  atualizarReadout();
}

function showError(msg) {
  const el = document.getElementById('errorBar');
  el.textContent = '⚠ ' + msg; el.style.display = 'block';
}
function hideError() { document.getElementById('errorBar').style.display = 'none'; }



/* ── INIT ── */
document.getElementById('dataExame').valueAsDate = new Date();
atualizarReadout();
export { switchTab, atualizarReadout, handleFile, processFile, enviar, mostrarToast, resetForm, showError, hideError };
