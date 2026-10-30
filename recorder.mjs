import {chromium} from 'playwright';
import {mkdir,writeFile,readdir,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function checkUrl(value,allowed,{allowLoopback=false}={}){
 const u=new URL(value);if(u.username||u.password||!['https:','http:'].includes(u.protocol)||!allowed.has(u.origin))throw Error('This URL is outside ALLOWED_ORIGINS.');
 const h=u.hostname.toLowerCase();if(!allowLoopback&&(u.protocol!=='https:'||h==='localhost'||h.endsWith('.local')||h.includes(':')||/^\d+(\.\d+){0,3}$/.test(h)))throw Error('Use an explicitly allowed public HTTPS site.');
 return u.href;
}
function pointer(){
 addEventListener('DOMContentLoaded',()=>{
  const el=document.createElement('div');el.setAttribute('data-recorder-pointer','');el.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-80px,-80px);width:28px;height:38px;filter:drop-shadow(1px 2px 2px #0008)';
  el.innerHTML='<svg viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L3 29L11 21L19 35L25 31L17 18L27 17Z" fill="white" stroke="#18231d" stroke-width="2"/></svg>';document.documentElement.append(el);
  addEventListener('mousemove',e=>{el.style.transform=`translate(${e.clientX}px,${e.clientY}px)`},{passive:true});
  addEventListener('pointerdown',()=>{el.style.filter='drop-shadow(0 0 7px #ed9960)';setTimeout(()=>el.style.filter='drop-shadow(1px 2px 2px #0008)',200)},{passive:true});
 });
}
export class Recorder{
 constructor({origins,output='./recordings',allowLoopback=false,launch=()=>chromium.launch({headless:true}),maxSeconds=180,ffmpeg='ffmpeg'}={}){
  this.allowed=new Set(origins);if(!this.allowed.size)throw Error('Set ALLOWED_ORIGINS.');for(const o of this.allowed)checkUrl(o,this.allowed,{allowLoopback});this.output=resolve(output);this.allowLoopback=allowLoopback;this.launch=launch;this.maxSeconds=maxSeconds;this.ffmpeg=ffmpeg;this.session=null;this.busy=false;this.last=null;
 }
 async exclusive(fn){if(this.busy)throw Error('Another browser action is in progress.');this.busy=true;try{return await fn()}finally{this.busy=false}}
 url(v){return checkUrl(v,this.allowed,{allowLoopback:this.allowLoopback})}
 status(){return {recording:!!this.session,busy:this.busy,startedAt:this.session?.startedAt||null,url:this.session?.page.url()||null,allowedOrigins:[...this.allowed],lastRecording:this.last,maxSeconds:this.maxSeconds}}
 async cleanup(){await mkdir(this.output,{recursive:true});for(const name of await readdir(this.output)){if(!/^[\da-f-]{36}$/.test(name))continue;const p=join(this.output,name);if(Date.now()-(await stat(p)).mtimeMs>3600000&&name!==this.session?.id)await rm(p,{recursive:true,force:true})}}
 async start({url,width=1920,height=1080}={}){return this.exclusive(async()=>{
  this.url(url);if(this.session)throw Error('Stop the current recording first.');if(!Number.isInteger(width)||width<800||width>1920||!Number.isInteger(height)||height<600||height>1080)throw Error('Choose a viewport from 800×600 to 1920×1080.');await this.cleanup();if((await readdir(this.output)).length>=10)throw Error('Recording storage is full. Recordings expire after one hour.');
  const id=randomUUID(),dir=join(this.output,id);await mkdir(dir);let browser,context;
  try{browser=await this.launch();context=await browser.newContext({viewport:{width,height},recordVideo:{dir,size:{width,height}},acceptDownloads:false,serviceWorkers:'block'});await context.route('**/*',async route=>{try{const requestUrl=route.request().url();if(requestUrl.startsWith('data:')||requestUrl.startsWith('blob:'))return route.continue();this.url(requestUrl);await route.continue()}catch{await route.abort('blockedbyclient')}});await context.routeWebSocket('**/*',ws=>ws.close());await context.addInitScript(pointer);const page=await context.newPage();page.setDefaultTimeout(10000);context.on('page',p=>{if(p!==page)p.close().catch(()=>{})});page.on('dialog',d=>d.dismiss().catch(()=>{}));
   this.session={id,dir,browser,context,page,startedAt:new Date().toISOString(),events:[],width,height,pointer:{x:80,y:80}};this.session.timer=setInterval(()=>{if(!this.busy&&this.session&&Date.now()-Date.parse(this.session.startedAt)>=this.maxSeconds*1000)this.stop().catch(()=>{})},1000);this.session.timer.unref();await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});this.event('start');return this.status();
  }catch(e){clearInterval(this.session?.timer);this.session=null;await context?.close().catch(()=>{});await browser?.close().catch(()=>{});throw Error('Browser recording could not start: '+e.message)}
 })}
 event(action,target){const s=this.session;s.events.push({time:Date.now()-Date.parse(s.startedAt),action,...(target?{target}:{} )})}
 target(t={}){const p=this.session.page;let l;if(t.role&&t.name)l=p.getByRole(t.role,{name:t.name,exact:true});else if(t.label)l=p.getByLabel(t.label,{exact:true});else if(t.text)l=p.getByText(t.text,{exact:true});else throw Error('Choose a visible role and name, label, or exact text.');return l}
 async moveTo(l){await l.scrollIntoViewIfNeeded();const b=await l.boundingBox();if(!b)throw Error('Target is not visible.');const s=this.session,from={...s.pointer},to={x:b.x+b.width/2,y:b.y+b.height/2};for(let i=1;i<=16;i++){const u=i/16,e=u*u*(3-2*u);await s.page.mouse.move(from.x+(to.x-from.x)*e,from.y+(to.y-from.y)*e);await sleep(16)}s.pointer=to}
 async action({action,target,text,option,key,direction='down',pixels=500,url,seconds=1}={}){return this.exclusive(async()=>{
  const s=this.session;if(!s)throw Error('Start recording first.');const p=s.page;
  if(action==='navigate'){await p.goto(this.url(url),{waitUntil:'domcontentloaded'})}
  else if(action==='click'){const l=this.target(target);await this.moveTo(l);await sleep(150);await l.click()}
  else if(action==='type'){if(typeof text!=='string'||text.length>4000)throw Error('Text must be under 4000 characters.');const l=this.target(target);if((await l.getAttribute('type'))==='password')throw Error('Password entry is disabled while recording. Use synthetic demo accounts and data.');await this.moveTo(l);await l.click();await l.fill('');await l.pressSequentially(text,{delay:35})}
  else if(action==='select'){await this.target(target).selectOption(String(option))}
  else if(action==='scroll'){if(!['up','down'].includes(direction)||!Number.isFinite(pixels)||pixels<0||pixels>1600)throw Error('Scroll must be up/down, 0–1600 pixels.');const n=Math.max(1,Math.ceil(pixels/35));for(let i=0;i<n;i++){await p.mouse.wheel(0,pixels/n*(direction==='up'?-1:1));await sleep(20)}}
  else if(action==='key'){if(!['Tab','Enter','Escape','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Backspace'].includes(key))throw Error('Unsupported key.');await p.keyboard.press(key)}
  else if(action==='wait'){if(!Number.isFinite(seconds)||seconds<0||seconds>3)throw Error('Wait must be 0–3 seconds.');await sleep(seconds*1000)}
  else throw Error('Unknown browser action.');
  // Typed text is intentionally absent from the action log.
  this.event(action,target);return {ok:true,url:p.url(),recording:true};
 })}
 async snapshot(){return this.exclusive(async()=>{if(!this.session)throw Error('No active recording.');return {url:this.session.page.url(),outline:await this.session.page.locator('body').ariaSnapshot(),image:await this.session.page.screenshot({type:'png'})}})}
 async stop(){return this.exclusive(async()=>{
  const s=this.session;if(!s)throw Error('No active recording.');clearInterval(s.timer);this.event('stop');let raw;
  try{const video=s.page.video();await s.context.close();raw=await video.path();await video.saveAs(join(s.dir,'workflow.webm'))}finally{await s.browser.close().catch(()=>{});this.session=null}
  const recordedSeconds=Math.round((Date.now()-Date.parse(s.startedAt))/100)/10;
  let format='webm',conversionError=null;try{await convert(this.ffmpeg,join(s.dir,'workflow.webm'),join(s.dir,'workflow.mp4'));format='mp4'}catch{conversionError='MP4 conversion unavailable; the original WebM recording is preserved.'}
  if(raw&&raw!==join(s.dir,'workflow.webm'))await rm(raw,{force:true});const result={id:s.id,format,fileName:'workflow.'+format,seconds:recordedSeconds,width:s.width,height:s.height,startedAt:s.startedAt,conversionError};await writeFile(join(s.dir,'events.json'),JSON.stringify(s.events,null,2));await writeFile(join(s.dir,'recording.json'),JSON.stringify(result,null,2));this.last=result;return result;
 })}
}
export function convert(binary,input,output){return new Promise((resolve,reject)=>{const p=spawn(binary,['-nostdin','-v','error','-y','-i',input,'-c:v','libx264','-crf','18','-preset','fast','-threads','1','-pix_fmt','yuv420p','-an','-movflags','+faststart',output],{stdio:'ignore'});const t=setTimeout(()=>{p.kill();reject(Error('Conversion timed out'))},60000);p.once('error',e=>{clearTimeout(t);reject(e)});p.once('close',code=>{clearTimeout(t);code===0?resolve():reject(Error('Conversion failed'))})})}
