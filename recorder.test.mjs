import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,copyFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Recorder,checkUrl,convert} from './recorder.mjs';
import {makeMcp} from './tools.mjs';
import {PersonalAuth} from './auth.mjs';
import {config,createApp} from './server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const origin='https://demo.example';
function fakeBrowser(root){const events=[];let current='about:blank',routeFn;
 const locator={scrollIntoViewIfNeeded:async()=>{},boundingBox:async()=>({x:10,y:10,width:50,height:30}),click:async()=>events.push('click'),getAttribute:async k=>k==='type'?'text':null,fill:async()=>{},pressSequentially:async t=>events.push('typed:'+t.length),selectOption:async()=>events.push('select'),ariaSnapshot:async()=>'- button "Apply"'};
 const page={url:()=>current,setDefaultTimeout:()=>{},goto:async u=>{current=u},on:()=>{},getByRole:()=>locator,getByLabel:()=>locator,getByText:()=>locator,locator:()=>locator,mouse:{move:async()=>events.push('move'),wheel:async()=>events.push('scroll')},keyboard:{press:async()=>events.push('key')},screenshot:async()=>Buffer.from('test image'),video:()=>({path:async()=>join(root,'raw.webm'),saveAs:async p=>copyFile(join(root,'raw.webm'),p)})};
 const context={route:async(_pattern,fn)=>{routeFn=fn},routeWebSocket:async()=>{},addInitScript:async()=>{},newPage:async()=>page,on:()=>{},close:async()=>events.push('context closed')};
 return {browser:{newContext:async options=>{events.push(options);return context},close:async()=>events.push('browser closed')},page,locator,events,get route(){return routeFn}};
}
test('URL policy rejects unapproved origins, credentials, internal addresses and schemes',()=>{
 const allowed=new Set([origin,'http://127.0.0.1:8123']);assert.equal(checkUrl(origin+'/jobs',allowed),origin+'/jobs');
 for(const u of ['https://evil.example','https://demo.example.evil.test','https://user:pass@demo.example','file:///etc/passwd','http://127.0.0.1:8123'])assert.throws(()=>checkUrl(u,allowed));
 assert.equal(checkUrl('http://127.0.0.1:8123',allowed,{allowLoopback:true}),'http://127.0.0.1:8123/');
});
test('real recorder lifecycle uses browser video, named actions, network policy and no typed-text logging (browser mocked)',async()=>{
 const root=await mkdtemp(join(tmpdir(),'recorder-'));await writeFile(join(root,'raw.webm'),'synthetic test video');const fake=fakeBrowser(root),r=new Recorder({origins:[origin],output:join(root,'out'),launch:async()=>fake.browser,ffmpeg:'no-such-ffmpeg'});
 try{await r.start({url:origin,width:1280,height:720});assert.equal(r.status().recording,true);assert(fake.events[0].recordVideo);assert.equal(fake.events[0].serviceWorkers,'block');await assert.rejects(()=>r.start({url:origin}),/Stop/);
  let result;await fake.route({request:()=>({url:()=>origin+'/style.css'}),continue:async()=>{result='allowed'},abort:async()=>{result='blocked'}});assert.equal(result,'allowed');await fake.route({request:()=>({url:()=>'https://evil.example'}),continue:async()=>{result='allowed'},abort:async()=>{result='blocked'}});assert.equal(result,'blocked');
  await r.action({action:'click',target:{role:'button',name:'Apply'}});await r.action({action:'type',target:{label:'Name'},text:'Fictional Person'});await r.action({action:'scroll',pixels:75,direction:'down'});await assert.rejects(()=>r.action({action:'scroll',pixels:2000}),/Scroll/);fake.locator.getAttribute=async()=> 'password';await assert.rejects(()=>r.action({action:'type',target:{label:'Password'},text:'never-log-this'}),/Password entry/);assert(!JSON.stringify(r.session.events).includes('Fictional Person'));assert(!JSON.stringify(r.session.events).includes('never-log-this'));
  const stopped=await r.stop();assert.equal(stopped.format,'webm');assert(stopped.conversionError);assert.equal(r.status().recording,false);assert(fake.events.includes('context closed'));assert(fake.events.includes('browser closed'));assert.equal(await readFile(join(root,'out',stopped.id,'workflow.webm'),'utf8'),'synthetic test video');
 }finally{await rm(root,{recursive:true,force:true})}
});
test('MCP client can discover and invoke the five actual tool schemas',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mcp-recorder-'));const r=new Recorder({origins:[origin],output:root});const s=makeMcp(r);const c=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([s.connect(a),c.connect(b)]);
 try{const tools=await c.listTools();assert.equal(tools.tools.length,5);assert(tools.tools.find(x=>x.name==='browser_start_video'));const status=await c.callTool({name:'browser_recording_status',arguments:{}});assert.equal(JSON.parse(status.content[0].text).recording,false);const bad=await c.callTool({name:'browser_start_video',arguments:{url:'https://evil.example'}});assert(bad.isError)}finally{await c.close();await s.close();await rm(root,{recursive:true,force:true})}
});
test('OAuth codes are one-use, client-bound, redirect-bound, scoped and refresh tokens rotate',async()=>{
 const a=new PersonalAuth('https://recorder.example'),c=await a.clientsStore.registerClient({redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'});let to;
 try{await a.authorize(c,{codeChallenge:'challenge',redirectUri:'https://client.example/callback',scopes:['browser:record'],resource:new URL(a.resource)},{redirect:u=>{to=u}});const redirect=new URL(a.approve(to.split('/').at(-1)));const code=redirect.searchParams.get('code');await assert.rejects(()=>a.exchangeAuthorizationCode(c,code,undefined,'https://wrong.example'),/Redirect/);await assert.rejects(()=>a.challengeForAuthorizationCode({client_id:'different'},code));assert.equal(await a.challengeForAuthorizationCode(c,code),'challenge');const tokens=await a.exchangeAuthorizationCode(c,code,undefined,'https://client.example/callback',new URL(a.resource));await assert.rejects(()=>a.challengeForAuthorizationCode(c,code));assert.equal((await a.verifyAccessToken(tokens.access_token)).resource,a.resource);await assert.rejects(()=>a.exchangeRefreshToken(c,tokens.refresh_token,['admin']));const next=await a.exchangeRefreshToken(c,tokens.refresh_token);await assert.rejects(()=>a.exchangeRefreshToken(c,tokens.refresh_token));await assert.rejects(()=>a.verifyAccessToken(tokens.access_token));await a.revokeToken(c,{token:next.refresh_token});await assert.rejects(()=>a.verifyAccessToken(next.access_token))}finally{a.close()}
});
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
test('HTTP console, OAuth discovery/PKCE and authenticated Streamable HTTP work end to end',async()=>{
 const port=await freePort(),base=`http://127.0.0.1:${port}`,root=await mkdtemp(join(tmpdir(),'recorder-http-')),c=config({PORT:String(port),PUBLIC_URL:base,RECORDER_PASSWORD:'synthetic-test-password-only',OUTPUT_DIR:root,ALLOWED_ORIGINS:origin});const service=createApp(c),http=service.app.listen(port,'127.0.0.1');await new Promise(r=>http.once('listening',r));
 const post=(path,body,headers={},form=false)=>fetch(base+path,{method:'POST',headers:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json',...headers},body:form?new URLSearchParams(body):JSON.stringify(body),redirect:'manual'});
 try{assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/api/status')).status,401);assert.equal((await post('/login',{password:c.password})).status,403);const login=await post('/login',{password:c.password},{Origin:base},true);assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/api/status',{headers:{Cookie:cookie}})).status,200);assert.equal((await post('/api/start',{url:origin},{Cookie:cookie,Origin:'https://evil.example'})).status,403);assert.equal((await fetch(base+'/download/fake')).status,404);
  const discovery=await (await fetch(base+'/.well-known/oauth-protected-resource/mcp')).json();assert.equal(discovery.resource,base+'/mcp');assert.equal((await post('/mcp',{})).status,401);
  const registration=await post('/register',{client_name:'Test client',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});assert.equal(registration.status,201);const client=await registration.json();const verifier='x'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');const qs=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:'https://client.example/callback',code_challenge:challenge,code_challenge_method:'S256',scope:'browser:record',resource:base+'/mcp',state:'state-1'});const authorize=await fetch(base+'/authorize?'+qs,{redirect:'manual'});assert.equal(authorize.status,302);const consent=authorize.headers.get('location');const approved=await post(consent,{password:c.password},{Origin:base},true);assert.equal(approved.status,303);const callback=new URL(approved.headers.get('location'));assert.equal(callback.searchParams.get('state'),'state-1');const exchange={grant_type:'authorization_code',code:callback.searchParams.get('code'),client_id:client.client_id,redirect_uri:'https://client.example/callback',resource:base+'/mcp'};assert.equal((await post('/token',{...exchange,code_verifier:'y'.repeat(64)},{},true)).status,400);const token=await post('/token',{...exchange,code_verifier:verifier},{},true);assert.equal(token.status,200);const tokens=await token.json();assert.equal((await post('/token',{...exchange,code_verifier:verifier},{},true)).status,400);
  const mcp=new Client({name:'http-test',version:'1'});await mcp.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));try{assert.equal((await mcp.listTools()).tools.length,5);const status=await mcp.callTool({name:'browser_recording_status',arguments:{}});assert.equal(JSON.parse(status.content[0].text).recording,false)}finally{await mcp.close()}
 }finally{await service.close();await new Promise(r=>http.close(r));await rm(root,{recursive:true,force:true})}
});

test('video export converts real WebM bytes to a playable MP4 (synthetic media)',async()=>{
 const root=await mkdtemp(join(tmpdir(),'recorder-convert-')),exec=promisify(execFile),input=join(root,'sample.webm'),output=join(root,'sample.mp4');
 try{await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=green:s=320x180:r=25','-t','1','-c:v','libvpx','-threads','1',input]);await convert('ffmpeg',input,output);const {stdout}=await exec('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height','-of','json',output]);const data=JSON.parse(stdout);assert.equal(data.streams[0].codec_name,'h264');assert.equal(data.streams[0].width,320);assert((await readFile(output)).length>1000)}finally{await rm(root,{recursive:true,force:true})}
});

test('phone console JavaScript parses, contains no password, and escapes dynamic HTML',async()=>{
 const {consolePage,passwordPage}=await import('./ui.mjs');const {Script}=await import('node:vm');const page=consolePage({origins:[origin],base:'https://recorder.example',nonce:'test-nonce'});const script=page.match(/<script nonce="test-nonce">([\s\S]*)<\/script>/)[1];assert.doesNotThrow(()=>new Script(script));assert.match(page,/width=device-width/);assert.match(page,/Stop &amp; save video|Stop & save video/);const html=passwordPage({client:'<script>alert(1)</script>',origins:[origin],nonce:'nonce'});assert(!html.includes('<script>alert(1)</script>'));assert(html.includes('&lt;script&gt;'));
});
