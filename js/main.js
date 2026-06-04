// OrthoX — Main Bootstrap Module
// Replaces inline <script type="module"> in index.html
import CFG from './config.js';
import { switchTab, atualizarReadout, handleFile, processFile, enviar, mostrarToast, resetForm, showError, hideError } from './upload.js';
import { buscarLaudos, renderLaudos, iniciarPolling, atualizarNotif, atualizarValNotif } from './laudos.js';
import { buscarValidacoes, renderValidacoes, abrirEditor, toggleBloco, onBlocoInput, confirmarBloco, editarBloco, setEstadoBloco, atualizarProgressBar, atualizarPreview, escHtml, esc, montarPayloadAprovacao, dispararWebhookAprovacao, finalizarLaudo, inicializarOdontograma, toggleDente, atualizarTextoDenticao, aprovarSemEditar, dispararWebhookReprint, loadChartJS } from './validacao.js';
import { initDashboard } from './dashboard.js';

// Expose functions to global scope (needed by onclick handlers in HTML)
window.switchTab = switchTab;
window.atualizarReadout = atualizarReadout;
window.handleFile = handleFile;
window.enviar = enviar;
window.buscarLaudos = buscarLaudos;
window.buscarValidacoes = buscarValidacoes;
window.abrirEditor = abrirEditor;
window.toggleBloco = toggleBloco;
window.onBlocoInput = onBlocoInput;
window.confirmarBloco = confirmarBloco;
window.editarBloco = editarBloco;
window.toggleDente = toggleDente;
window.aprovarSemEditar = aprovarSemEditar;
window.finalizarLaudo = finalizarLaudo;
window.atualizarNotif = atualizarNotif;
window.atualizarValNotif = atualizarValNotif;
window.iniciarPolling = iniciarPolling;
window.initDashboard = initDashboard;

// Initialize
iniciarPolling();
initDashboard();
