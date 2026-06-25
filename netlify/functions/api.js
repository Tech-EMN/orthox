exports.handler = async (event) => {
  const token = event.queryStringParameters?.token || '';
  if (!token) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Token ausente', errorMessage: 'Forneca um token de acesso.' }) };
  }
  const https = require('https');
  const html = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'script.google.com',
      path: '/macros/s/AKfycbxy8yktI28t32uD7sxpkv0uUTe6wgNO1ho03XOVnDYkxRWy4fVZ0wEY1zh7O8VhofBLeg/exec?token=' + encodeURIComponent(token),
      method: 'GET', timeout: 15000
    }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
    req.on('error',e=>reject(e));
    req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});
    req.end();
  });
  const match = html.match(/var DATA_PROPS\s*=\s*({[\s\S]*?});/);
  if (!match) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro', errorMessage: 'Servidor indisponivel. Tente novamente.' }) };
  }
  try {
    const data = JSON.parse(match[1]);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
  } catch(e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro', errorMessage: 'Resposta invalida.' }) };
  }
};
