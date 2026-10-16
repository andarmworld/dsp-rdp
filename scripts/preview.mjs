// Visual-only local harness: actual production component with explicit mock RPC.
import { build } from 'esbuild'
import { createServer } from 'node:http'
const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RdpPanel } from './src/RdpPanel.tsx';
import { setRpcTransport } from './src/api.ts';
let machines = [{id:'11111111-1111-4111-8111-111111111111',name:'工作站示例',username:'示例用户',address:'workstation.example',gatewayId:'preview',lastConnectedAt:null,hasSavedPassword:false,url:'/preview-empty.html'}];
let events = [];
const append = (machine,event,detail) => events.unshift({id:crypto.randomUUID(),machineId:machine.id,machineName:machine.name,address:machine.address,username:machine.username,event,occurredAt:new Date().toISOString(),...(detail?{detail}:{})});
setRpcTransport(async (endpoint,payload) => {
 const found = machines.find(machine=>machine.id===payload.id);
 let value = null;
 switch(endpoint) {
  case 'machines/list': value={machines}; break;
  case 'history/list': value={events:payload.machineId?events.filter(event=>event.machineId===payload.machineId):events};break;
  case 'machines/save': case 'machines/edit': {
   if(!payload.name||!payload.username||!payload.address)return {ok:false,error:{code:'rdp/bad-request',message:'请填写机器名称、登录名和机器地址。',details:{status:400}}};
   const machine={...(found||{id:crypto.randomUUID(),gatewayId:'preview',lastConnectedAt:null,url:'/preview-empty.html'}),name:payload.name,username:payload.username,address:payload.address,hasSavedPassword:Boolean(payload.rememberPassword)};
   machines=[...machines.filter(item=>item.id!==machine.id),machine];value=machine;break;
  }
  case 'machines/delete':machines=machines.filter(machine=>machine.id!==payload.id);break;
  case 'machines/connect':if(found)append(found,'attempt');value={url:'/preview-empty.html',reused:false};break;
  case 'machines/event':if(found)append(found,payload.event);break;
  case 'machines/connected':value=found;break;
  default:return {ok:false,error:{code:'rdp/not-found',message:'预览不支持此操作。',details:{status:404}}};
 }
 return {ok:true,value};
});
createRoot(document.getElementById('app')).render(React.createElement(RdpPanel));`
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"development"' } })
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>远程桌面 · 本地界面预览</title><style>html,body,#app{margin:0;min-height:100%;height:100%;font-family:system-ui,sans-serif;color:#222}*{box-sizing:border-box}body{background:#fff}</style><aside style="padding:8px;background:#eef5ff">本地界面预览 · 模拟 RPC 数据，不连接远程机器</aside><div id="app"></div><script type="module" src="/preview.js"></script></html>'
createServer((req, res) => {
 if(req.url==='/preview.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bundle.outputFiles[0].contents);return}
 res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
 res.end(req.url==='/preview-empty.html'?'<p>此预览不连接远程桌面。请在 DSH 中完成真实连接验收。</p>':html)
}).listen(4173,'127.0.0.1',()=>console.log('RDP actual-component mock-RPC preview: http://127.0.0.1:4173'))
