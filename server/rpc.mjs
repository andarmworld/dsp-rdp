import { HttpError, parseObject, parseMachine, parseCredentials } from './input.mjs';

const string = (value, field) => {
  if (typeof value !== 'string' || !value || value.length > 200 || /[\x00-\x1f\x7f]/u.test(value)) throw new HttpError(400, `${field}无效`);
  return value;
};
const reasons = { closed: '桌面视图已关闭', cancelled: '连接已取消', gateway: '远程桌面网关连接异常', client: '远程桌面客户端连接异常' };
export function createRpcHandler(manager, owner) {
  return async (endpoint, payload, signal) => {
    try {
      if (signal?.aborted) throw new HttpError(400, '请求已取消');
      const value = parseObject(payload);
      if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw new HttpError(400, '请求内容过大');
      const result = await manager.exclusive(async () => {
        switch (endpoint) {
          case 'machines/list': return manager.list(owner);
          case 'machines/save': return manager.save(owner, parseMachine(value));
          case 'machines/edit': return manager.save(owner, parseMachine(value), string(value.id, '机器编号'));
          case 'machines/delete': await manager.delete(owner, string(value.id, '机器编号')); return null;
          case 'machines/connect': return manager.connect(owner, string(value.id, '机器编号'), parseCredentials(value));
          case 'machines/connected': return manager.connected(owner, string(value.id, '机器编号'), string(value.sessionId, '会话编号'));
          case 'machines/event': {
            if (!['failed', 'disconnected'].includes(value.event) || (value.reason !== undefined && !Object.hasOwn(reasons, value.reason))) throw new HttpError(400, '连接事件无效');
            const id = string(value.id, '机器编号'), sessionId = value.sessionId === undefined ? undefined : string(value.sessionId, '会话编号');
            await manager.event(owner, id, { event: value.event, sessionId, detail: reasons[value.reason] ?? '远程桌面会话已结束' }); return null;
          }
          case 'history/list': return manager.history(owner, { machineId: value.machineId === undefined ? undefined : string(value.machineId, '机器编号'), cursor: value.cursor === undefined ? undefined : string(value.cursor, '历史游标') });
          default: throw new HttpError(404, '接口不存在');
        }
      });
      return { ok: true, value: result };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      return { ok: false, error: { code: `rdp/${status === 400 ? 'bad-request' : status === 404 ? 'not-found' : status === 403 ? 'forbidden' : 'gateway'}`, message: error instanceof HttpError ? error.message : '远程桌面服务操作失败', details: { status } } };
    }
  };
}
