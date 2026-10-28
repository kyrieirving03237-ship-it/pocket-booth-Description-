import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SITE_URL||'http://127.0.0.1:4179';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
try{
 const ctx=await browser.newContext({viewport:{width:320,height:740},permissions:['microphone']}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Base=AudioContext;window.__diagnosticContexts=[];window.AudioContext=new Proxy(Base,{construct(target,args){const value=Reflect.construct(target,args);window.__diagnosticContexts.push(value);return value;}});const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(...args)=>window.__hangCapture?new Promise(resolve=>window.__resolveCapture=async()=>{const stream=await gum(...args);window.__lateStream=stream;resolve(stream);}):gum(...args);});
 await page.goto(base+'/diagnostics.html');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>window.__hangCapture=true);await page.locator('#connect').click();await page.waitForFunction(()=>typeof window.__resolveCapture==='function');await page.locator('#cancel').click();await page.waitForFunction(()=>document.querySelector('#cancel').disabled);await page.evaluate(()=>window.__resolveCapture());await page.waitForFunction(()=>window.__lateStream?.getAudioTracks()[0].readyState==='ended');console.log('PASS pending permission/request can be cancelled; late stream immediately released');
 for(const mode of ['device-change','background','suspended-context']){
  await page.reload();await page.locator('#route').selectOption('earpods');await page.locator('#coupled').check();await page.locator('#routeConfirmed').check();await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('接続済み'));await page.locator('#probe').click();await page.waitForTimeout(250);
  if(mode==='device-change')await page.evaluate(()=>navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  else if(mode==='background')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  else await page.evaluate(()=>window.__diagnosticContexts.at(-1).suspend());
  await page.waitForFunction(()=>document.querySelector('#cancel').disabled,{},{timeout:8000});assert.equal(await page.locator('#measure').isDisabled(),true);assert.match(await page.locator('#connection').textContent(),/解放/);assert.ok(await page.evaluate(()=>window.__diagnosticContexts.every(c=>c.state==='closed')));console.log('PASS interrupted diagnostic releases context and blocks measurement:',mode);
 }
 assert.deepEqual(errors,[]);await ctx.close();
}finally{await browser.close();}
