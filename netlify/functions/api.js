const https = require('https');

exports.handler = async (event) => {
  const token = (event.queryStringParameters?.token || '').trim();
  if (!token) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Token ausente', errorMessage: 'Forneca um token de acesso.' }) };
  }

  try {
    const html = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'script.google.com',
        path: '/macros/s/AKfyc…eg/exec?token=' + encodeURIComponent(token),
        method: 'GET',
        headers: { 'User-Agent': 'NetlifyFunction/1.0' },
        timeout: 20000
      };
      const req = https.get(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', (e) => reject(e.message));
      req.on('timeout', () => { req.destroy(); reject('timeout'); });
    });

    const match = html.match(/var DATA_PROPS\s*=\s*({[\s\S]*?});/);
    if (!match) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro', errorMessage: 'Resposta invalida do servidor.', debug: html.substring(0,200) }) };
    }
    
    const data = JSON.parse(match[1]);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
    
  } catch(e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro de conexao', errorMessage: String(e).substring(0,200) }) };
  }
};
