const crypto = require('crypto');
const https = require('https');

function config() {
  const endpoint = process.env.MEDIA_S3_ENDPOINT || '';
  const c = {
    endpoint: endpoint ? new URL(endpoint) : null,
    region: process.env.MEDIA_S3_REGION || 'sa-east-1',
    bucket: process.env.MEDIA_S3_BUCKET || '',
    keyId: process.env.MEDIA_S3_ACCESS_KEY_ID || '',
    secret: process.env.MEDIA_S3_SECRET_ACCESS_KEY || '',
    prefix: (process.env.MEDIA_S3_PREFIX || 'private/chat').replace(/^\/+|\/+$/g, ''),
  };
  if (!c.endpoint || c.endpoint.protocol !== 'https:' || !c.bucket || !c.keyId || !c.secret) return null;
  if (c.endpoint.pathname !== '/' || c.endpoint.search) return null;
  return c;
}
function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function hmac(key, str) { return crypto.createHmac('sha256', key).update(str).digest(); }
function signingKey(c, date) {
  return hmac(hmac(hmac(hmac('AWS4' + c.secret, date), c.region), 's3'), 'aws4_request');
}
function encode(str) { return encodeURIComponent(str).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase()); }
function objectPath(c, key) {
  return '/' + encode(c.bucket) + '/' + key.split('/').map(encode).join('/');
}
function makeKey(id, scopeType, scopeId, ext) {
  const c = config();
  if (!c) throw new Error('Armazenamento indisponível');
  return c.prefix + '/' + scopeType + '/' + scopeId + '/' + id + '.' + ext;
}
function signedHeaders(c, method, key, payload, mime) {
  const now = new Date();
  const dateTime = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = dateTime.slice(0, 8);
  const host = c.endpoint.host;
  const payloadHash = sha(payload);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': dateTime };
  if (mime) headers['content-type'] = mime;
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map(k => k + ':' + headers[k].trim() + '\n').join('');
  const signed = headerNames.join(';');
  const canonical = [method, objectPath(c, key), '', canonicalHeaders, signed, payloadHash].join('\n');
  const scope = date + '/' + c.region + '/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha(canonical)].join('\n');
  const sig = crypto.createHmac('sha256', signingKey(c, date)).update(stringToSign).digest('hex');
  headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + c.keyId + '/' + scope + ', SignedHeaders=' + signed + ', Signature=' + sig;
  return headers;
}
async function put(key, data, mime) {
  const c = config();
  if (!c) throw new Error('Armazenamento S3 não configurado');
  const headers = signedHeaders(c, 'PUT', key, data, mime);
  headers['content-length'] = String(data.length);
  const response = await new Promise((resolve, reject) => {
    const req = https.request({
      protocol: 'https:', hostname: c.endpoint.hostname, port: c.endpoint.port || 443,
      method: 'PUT', path: objectPath(c,key), headers, timeout: 45000,
    }, res => {
      let responseBytes = 0;
      res.on('data', chunk => { responseBytes += chunk.length; });
      res.on('end', () => resolve({ status: res.statusCode, responseBytes }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo de resposta do S3 esgotado')));
    req.on('error', reject);
    req.end(data);
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('O armazenamento S3 rejeitou o envio (' + response.status + ')');
  }
}
function getUrl(key, expires=90) {
  const c=config();
  if (!c) throw new Error('Armazenamento S3 não configurado');
  const dateTime = new Date().toISOString().replace(/[-:]|\.\d{3}/g,'');
  const date=dateTime.slice(0,8);
  const scope=date+'/'+c.region+'/s3/aws4_request';
  const params={
    'X-Amz-Algorithm':'AWS4-HMAC-SHA256',
    'X-Amz-Credential':c.keyId+'/'+scope,
    'X-Amz-Date':dateTime,
    'X-Amz-Expires':String(expires),
    'X-Amz-SignedHeaders':'host',
  };
  const query=Object.keys(params).sort().map(k=>encode(k)+'='+encode(params[k])).join('&');
  const canonical=['GET',objectPath(c,key),query,'host:'+c.endpoint.host+'\n','host','UNSIGNED-PAYLOAD'].join('\n');
  const toSign=['AWS4-HMAC-SHA256',dateTime,scope,sha(canonical)].join('\n');
  const sig=crypto.createHmac('sha256',signingKey(c,date)).update(toSign).digest('hex');
  return c.endpoint.origin+objectPath(c,key)+'?'+query+'&X-Amz-Signature='+sig;
}
async function remove(key) {
  const c=config();
  if (!c) throw new Error('Armazenamento S3 não configurado');
  const headers=signedHeaders(c,'DELETE',key,Buffer.alloc(0),null);
  const response=await new Promise((resolve,reject)=>{
    const req=https.request({
      protocol:'https:',hostname:c.endpoint.hostname,port:c.endpoint.port || 443,
      method:'DELETE',path:objectPath(c,key),headers,timeout:25000,
    },res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('timeout',()=>req.destroy(new Error('Timeout no S3')));
    req.on('error',reject);
    req.end();
  });
  if (response >= 300 && response !== 404) throw new Error('Falha ao excluir mídia do S3 ('+response+')');
}
module.exports={config,makeKey,put,getUrl,remove};
