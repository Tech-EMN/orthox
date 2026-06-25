// Netlify Function: Portal ATRIA API Proxy
// Uses native fetch (Node 18+) instead of https module to avoid encoding issues

const SCRIPT_ID = 'AKfyc…eg';

exports.handler = async (event) => {
  const token = (event.queryStringParameters?.token || '').trim();
  if (!token) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Token ausente', errorMessage: 'Forneca um token de acesso.' }) };
  }

  try {
    const url = 'https://script.google.com/macros/s/' + SCRIPT_ID + '/exec?token=' + encodeURIComponent(token);
    
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const html = await response.text();

    const match = html.match(/var DATA_PROPS\s*=\s*({[\s\S]*?});/);
    if (!match) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'API indisponivel', errorMessage: 'Resposta inesperada do servidor ATRIA.', debugHtml: html.substring(0,250) }) };
    }
    
    const data = JSON.parse(match[1]);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
    
  } catch(e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro de conexao', errorMessage: String(e).substring(0,300) }) };
  }
};
