const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../index');
const { createStore } = require('../db');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'xenoterm-download-test-'));
const file = 'XenoTerm-Setup-1.7.0.exe';
fs.writeFileSync(path.join(root,file),Buffer.alloc(1024,'x'));
fs.writeFileSync(path.join(root,'latest.yml'),'version: 1.7.0\n');
fs.writeFileSync(path.join(root,'release.json'),JSON.stringify({version:'1.7.0',fileName:file,size:1024}));
const store=createStore(':memory:');
const app=createApp({config:{adminToken:'test-admin-key',downloads:{dir:root,publicBaseUrl:'https://example.com'}},store});
const server=app.listen(0,'127.0.0.1');
const ready=new Promise(resolve=>server.on('listening',resolve));
async function request(url,options={}){await ready;const response=await fetch(`http://127.0.0.1:${server.address().port}${url}`,options);await response.arrayBuffer();return response;}
after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(root,{recursive:true,force:true});});
test('admin statistics require authentication',async()=>{assert.equal((await request('/api/stats/downloads')).status,401);assert.equal((await request('/api/stats/downloads',{headers:{authorization:'Bearer test-admin-key'}})).status,200);});
test('only served downloads count, and retries/resume do not inflate totals',async()=>{
  const url='/api/download/'+file;
  await request(url,{method:'HEAD'});await request('/api/download/missing.exe');await request(url,{headers:{range:'bytes=5000-'}});
  assert.equal(store.stats().summary.downloads,0);
  assert.equal((await request(url)).status,200);await request(url);await request(url,{headers:{range:'bytes=0-99'}});await request(url,{headers:{range:'bytes=100-199'}});
  assert.equal(store.stats().summary.downloads,1);
  await request('/downloads/'+file);assert.equal(store.stats().summary.downloads,1);
  await request('/api/update/'+file,{headers:{'user-agent':'test-updater'}});assert.equal(store.stats().summary.update_downloads,1);
  await request('/api/update/latest.yml');assert.equal(store.stats().summary.update_checks,1);
  assert.equal(store.stats().summary.downloads,2);
});
test('private and traversal paths cannot be downloaded',async()=>{
  for(const name of ['release.json','..%2Fconfig.js','%2Fetc%2Fpasswd','.admin-token'])assert.equal((await request('/api/download/'+name)).status,404);
});
test('payment creation is retired and latest release remains available',async()=>{assert.equal((await request('/api/pay/create',{method:'POST'})).status,410);assert.equal((await request('/api/license/activate',{method:'POST'})).status,410);assert.equal((await request('/api/release')).status,200);});
test('deduplication expires and daily statistics use Beijing date',()=>{
  const event={type:'manual_download',file,version:'1.7.0',source:'website'};
  assert.equal(store.record(event,'another-client',Date.now()),true);
  assert.equal(store.record(event,'another-client',Date.now()+1000),false);
  assert.equal(store.record(event,'another-client',Date.now()+1800001),true);
  assert.equal(store.stats().summary.today_downloads,4);
  assert.equal(store.stats().daily.at(-1).downloads,4);
  assert.equal('client_ip' in store.stats().recent[0],false);
});
