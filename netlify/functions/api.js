const https = require('https');

exports.handler = async (event) => {
  const token = (event.queryStringParameters?.token || '').trim();
  if (!token) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Token ausente', errorMessage: 'Forneca um token de acesso.' }) };
  }

  try {
    // Use exact URL string - no URL class encoding
    const path = '/macros/s/AKfyc…eg/exec?token=' + encodeURIComponent(token);
    
    const html = await new Promise((resolve, reject) => {
      const req = https.get({
        hostname: 'script.google.com',
        path: path,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 20000
      }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          const url2 = new URL(loc);
          const req2 = https.get({
            hostname: url2.hostname,
            path: url2.pathname + url2.search,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 20000
          }, (res2) => {
            let data = '';
            res2.on('data', c => data += c);
            res2.on('end', () => resolve(data));
          });
          req2.on('error', e => reject(e.message));
          req2.setTimeout(20000, () => { req2.destroy(); reject('timeout2'); });
          return;
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', e => reject(e.message));
      req.setTimeout(20000, () => { req.destroy(); reject('timeout'); });
    });

    const match = html.match(/var DATA_PROPS\s*=\s*({[\s\S]*?});/);
    if (!match) {
      return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'API indisponivel', errorMessage: 'Tente novamente em instantes.', debugHtml: html.substring(0,200) }) };
    }
    
    const data = JSON.parse(match[1]);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
    
  } catch(e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro', errorMessage: String(e).substring(0,300) }) };
  }
};
