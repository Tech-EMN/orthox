const SCRIPT_ID = 'AKfycbxy8yktI28t32uD7sxpkv0uUTe6wgNO1ho03XOVnDYkxRWy4fVZ0wEY1zh7O8VhofBLeg';

exports.handler = async (event) => {
  const token = (event.queryStringParameters?.token || '').trim();
  if (!token) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Token ausente', errorMessage: 'Forneca um token de acesso.' }) };
  }

  try {
    const url = `https://script.google.com/macros/s/${SCRIPT_ID}/exec?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const html = await res.text();

    const match = html.match(/var DATA_PROPS\s*=\s*({[\s\S]*?});/);
    if (!match) {
      // Return debug info with HTML preview
      const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'no-title';
      const body = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 500).trim();
      return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'API indisponivel', errorMessage: 'Erro no servidor ATRIA.', title: title, bodyPreview: body }) };
    }
    
    const data = JSON.parse(match[1]);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
    
  } catch(e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: true, errorTitle: 'Erro de conexao', errorMessage: String(e).substring(0,300) }) };
  }
};
