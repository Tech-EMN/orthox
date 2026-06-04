const CFG = {
  webhookEnvio:   "https://n8n.servidoremn.site/webhook/OrthoX",
  webhookReprint: "https://n8n.servidoremn.site/webhook/OrthoX-Reprint",
  webhookAprovacao: "https://n8n.servidoremn.site/webhook/OrthoX-Aprovacao",
  orthoXToken:    "OrthoX-Prod-2026!", // Senha configurada no Header Auth do n8n
  
  // A chave abaixo é a 'anon key' (pública). Usada APENAS para ler (GET) a lista de laudos.
  // Nenhum salvamento ou edição é feito através dela, mantendo o banco seguro.
  supabaseUrl:    "https://jscrpagjdxdsovwcuxfk.supabase.co",
  supabaseKey:    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzY3JwYWdqZHhkc292d2N1eGZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NTc1MzUsImV4cCI6MjA5MDEzMzUzNX0.ySi-14EcMFXDVXvilzfIBNxhOdglI-3q0ehXrv9twJ4",
  tabela:         "laudos",
  pollSeg:        30,
};

export default CFG;
window.CFG = CFG;  // Legacy global access for mixed module/global code

// Shared utility functions
function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export { esc, escHtml };
