import { HttpError, parseObject } from './input.mjs';

export const RPC_ENDPOINTS = Object.freeze(['machines/list', 'machines/save', 'machines/edit', 'machines/delete', 'machines/connect', 'machines/connected', 'machines/event', 'history/list']);
export function fetchRoute(endpoint, handler) {
  return { path: `/api/rdp/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
    let rpcId = 'invalid-request';
    const respond = result => new Response(JSON.stringify({ type: 'server-response', rpcId, result }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    try {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') throw new HttpError(400, '请求必须使用 JSON');
      const reader = request.body?.getReader(), chunks = []; let size = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 65536) { await reader.cancel(); throw new HttpError(400, '请求内容过大'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
      }
      let body;
      try { body = parseObject(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { throw new HttpError(400, 'JSON 格式无效'); }
      const validId = typeof body.rpcId === 'string' && body.rpcId.length > 0 && body.rpcId.length <= 200;
      if (validId) rpcId = body.rpcId;
      if (!validId || body.type !== 'client-request' || body.method !== `rdp/${endpoint}`) throw new HttpError(400, '远程桌面请求格式无效');
      return respond(await handler(endpoint, body.payload, request.signal));
    } catch (error) {
      return respond({ ok: false, error: { code: error instanceof HttpError ? 'rdp/bad-request' : 'rdp/gateway', message: error instanceof HttpError ? error.message : '远程桌面请求处理失败', details: { status: error instanceof HttpError ? error.status : 502 } } });
    }
  } };
}
