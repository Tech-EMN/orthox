// Netlify Function: Portal ATRIA API Proxy
const https = require('https');
const { URL } = require('url');

const APPS_SCRIPT = 'https://script.google.com/macros/s/AKfyc…eg/exec';

exports.handler = async (event) => {
  const token = (event.queryStringParameters?.token || '').trim();
  if (!token) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Token ausente', errorMessage: 'Forneca um token de acesso.' }) };
  }

  try {
    const targetUrl = new URL(APPS_SCRIPT);
    targetUrl.searchParams.set('token', token);
    
    const html = await new Promise((resolve, reject) => {
      const req = https.get(targetUrl.toString(), (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', (e) => reject(e.message));
      req.setTimeout(20000, () => { req.destroy(); reject('timeout'); });
    });

    const match = html.match(/var DATA_PROPS\s*=\s*({[\s\S]*?});/);
    if (!match) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro', errorMessage: 'Resposta invalida do servidor ATRIA.', debugHtml: html.substring(0,300) }) };
    }
    
    const data = JSON.parse(match[1]);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
    
  } catch(e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro de conexao', errorMessage: String(e).substring(0,300) }) };
  }
};
