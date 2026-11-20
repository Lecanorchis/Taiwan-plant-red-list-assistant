// Run with a local Chromium executable. Uses a temporary browser profile and synthetic data.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'tprla-browser-check-'));
const browser = spawn(process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--disable-background-networking', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'], {windowsHide:true, stdio:'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = (await readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0]; }
    catch { await sleep(100); }
  }
  const targets = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket = new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.onopen=resolve);
  let serial=0;
  const callbacks=new Map();
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(callbacks.has(message.id)){callbacks.get(message.id)(message);callbacks.delete(message.id);}
  };
  function call(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++serial;
      callbacks.set(id,m=>m.error?reject(Error(m.error.message)):resolve(m.result));
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function run(expression){
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression){
    for(let i=0;i<80;i++){if(await run(expression))return;await sleep(100);}
    throw Error('Timeout: '+expression+'\n'+await run('document.body.innerText.slice(-1200)'));
  }
  await call('Page.enable');
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
  await call('Page.navigate',{url:pathToFileURL(path.resolve('workbench/index.html')).href});
  await until("document.querySelector('#firstProject') !== null");
  await run("firstProject.click();projectForm.elements.title.value='QA 試評';projectForm.requestSubmit()");
  await until("!!document.querySelector('#queries')");
  await run("queries.value='皿柱蘭屬';document.querySelector('#preview').click()");
  await until("document.querySelectorAll('[data-i]:checked').length===15");
  await run("applyList.click()");
  await until("document.querySelectorAll('[data-edit]').length===15");
  await run("document.querySelector('[data-edit]').click();editor.elements.assessmentNotes.value='測試草稿甲';editor.elements.assessmentNotes.dispatchEvent(new Event('input',{bubbles:true}))");
  await until("document.querySelector('#saved')?.textContent==='已保存於此瀏覽器'");
  await call('Page.reload');
  await until("document.querySelectorAll('[data-edit]').length===15");
  await run("document.querySelector('[data-edit]').click()");
  await until("document.querySelector('#editor')?.elements.assessmentNotes.value==='測試草稿甲'");
  await run("document.querySelector('[data-page=backup]').click()");
  await until("!!document.querySelector('#download')");
  await run("download.click()");
  let file;
  for(let i=0;i<50&&!file;i++){file=(await readdir(dir)).find(n=>n.endsWith('.zip'));await sleep(100);}
  if(!file)throw Error('Missing ZIP download');
  const doc=await call('DOM.getDocument');
  const input=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#archive'});
  await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path.join(dir,file)]});
  await until("!!document.querySelector('#restoreBtn')");
  await run("restoreBtn.click()");
  await until("document.querySelectorAll('#projects option').length===2 && document.querySelectorAll('[data-edit]').length===15");
  await run("document.querySelector('[data-edit]').click()");
  await until("document.querySelector('#editor')?.elements.assessmentNotes.value==='測試草稿甲'");
  console.log('Passed: genus expansion, editing, reload, ZIP download, restore and independent project copy.');
} finally {
  socket?.close();
  browser.kill();
}
