const https = require('node:https');

// Node transport keeps authorization outside Cypress request/error logs.
async function request(url, { method = 'GET', headers = {}, body, timeout = 30000 } = {}) {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('Request timeout must be between 1 and 120000 ms.');
  const signal = AbortSignal.timeout(timeout);
  const timeoutMessage = `Staging request exceeded its ${timeout}ms deadline.`;
  let payload;
  if (body instanceof FormData) {
    const encoded = new Request(url, { method, body });
    headers = { ...headers, 'content-type': encoded.headers.get('content-type') };
    payload = Buffer.from(await encoded.arrayBuffer());
  } else payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { ...headers, ...(payload === undefined ? {} : { 'Content-Length': Buffer.byteLength(payload) }) },
      signal,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('error', () => reject(new Error(signal.aborted ? timeoutMessage : 'Staging response stream failed.')));
      response.on('end', () => {
        let result;
        try { result = JSON.parse(text); } catch { result = text; }
        resolve({ status: response.statusCode, headers: { 'content-type': response.headers['content-type'] || '' }, body: result });
      });
    });
    req.on('error', error => reject(new Error(signal.aborted ? timeoutMessage : `Staging connection failed (${error.code || 'request error'}).`)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

module.exports = { request };
