import express from 'express';
import {demoPage} from './demo.mjs';
import {randomBytes} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,access} from 'node:fs/promises';
import {mcpAuthRouter,getOAuthProtectedResourceMetadataUrl} from '@modelcontextprotocol/sdk/server/auth/router.js';
import {requireBearerAuth} from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Recorder} from './recorder.mjs';
import {makeMcp,Start,Action} from './tools.mjs';
import {PersonalAuth,equal} from './auth.mjs';
import {passwordPage,consolePage} from './ui.mjs';
export function config(env=process.env){
 const port=Number(env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT.');
 const base=new URL(env.PUBLIC_URL||env.RENDER_EXTERNAL_URL||`http://127.0.0.1:${port}`);if(base.username||base.password||base.pathname!=='/'||base.search||base.hash||(base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname)))throw Error('PUBLIC_URL must be a public HTTPS origin, or loopback for local development.');
 const password=env.RECORDER_PASSWORD||'';if(password.length<16||password.length>300)throw Error('Set RECORDER_PASSWORD to at least 16 characters in the host environment.');
 const origins=(env.ALLOWED_ORIGINS||'https://align-career-match-rk.rkaura94.chatgpt.site').split(',').map(x=>new URL(x.trim()).origin);
 return {port,base:base.origin,password,origins,output:resolve(env.OUTPUT_DIR||'./recordings')};
}
export function createApp(c,recorder=new Recorder({origins:[...c.origins,...(c.base.startsWith("https:")?[c.base]:[])],output:c.output})){
 const app=express(),auth=new PersonalAuth(c.base),base=new URL(c.base),secure=base.protocol==='https:';
 let failedLogins=0,resetAt=Date.now()+900000;
 app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));app.use(express.urlencoded({extended:false,limit:'4kb'}));
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});res.locals.nonce=randomBytes(18).toString('base64');res.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${res.locals.nonce}'; style-src 'nonce-${res.locals.nonce}'; img-src 'self' blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);if(req.headers.host!==base.host)return res.status(400).json({error:'Unrecognized host.'});next()});
 const cookieValue=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('recorder='))?.slice(9);
 const signedIn=req=>auth.validCookie(cookieValue(req));
 const sameOrigin=(req,res,next)=>req.headers.origin===c.base?next():res.status(403).json({error:'Same-origin request required.'});
 const localAuth=(req,res,next)=>signedIn(req)?next():res.status(401).json({error:'Sign in to the recorder.'});
 const login=(password)=>{if(Date.now()>resetAt){failedLogins=0;resetAt=Date.now()+900000}if(failedLogins>=10)return false;if(!equal(password,c.password)){failedLogins++;return false}return true};
 const download=r=>new URL('/download/'+auth.download(r),c.base).href;
 const clean=setInterval(()=>recorder.cleanup().catch(()=>{}),300000);clean.unref();
 app.get('/walkthrough',(_req,res)=>res.type('html').send(demoPage(res.locals.nonce)));
 app.get('/healthz',(_req,res)=>res.json({ok:true}));
 app.get('/',(req,res)=>res.type('html').send(signedIn(req)?consolePage({...c,nonce:res.locals.nonce}):passwordPage({...c,nonce:res.locals.nonce})));
 app.post('/login',sameOrigin,(req,res)=>{if(!login(req.body.password))return res.status(401).send('Password not accepted. After ten failed attempts, wait 15 minutes.');res.cookie('recorder',auth.cookie(),{httpOnly:true,secure,sameSite:'strict',maxAge:8*3600000,path:'/'});res.redirect(303,'/')});
 app.post('/logout',sameOrigin,(req,res)=>{auth.cookies.delete(cookieValue(req));res.clearCookie('recorder',{httpOnly:true,secure,sameSite:'strict',path:'/'});res.redirect(303,'/')});
 app.get('/consent/:ticket',(req,res)=>{const p=auth.pending.get(req.params.ticket);if(!p||p.expiresAt<Date.now())return res.status(400).send('Authorization expired. Restart the connection.');res.type('html').send(passwordPage({...c,title:'Connect your assistant',action:'/consent/'+req.params.ticket,client:p.client.client_name||'MCP client',nonce:res.locals.nonce}))});
 app.post('/consent/:ticket',sameOrigin,(req,res)=>{if(!login(req.body.password))return res.status(401).send('Password not accepted.');try{res.redirect(303,auth.approve(req.params.ticket))}catch{res.status(400).send('Authorization expired. Restart the connection.')}});
 app.use(mcpAuthRouter({provider:auth,issuerUrl:new URL(c.base),resourceServerUrl:new URL('/mcp',c.base),scopesSupported:['browser:record'],resourceName:'Align Workflow Recorder'}));
 app.use('/mcp',(req,res,next)=>req.headers.origin&&req.headers.origin!==c.base?res.status(403).json({error:'Origin not allowed.'}):next());
 app.all('/mcp',requireBearerAuth({verifier:auth,requiredScopes:['browser:record'],expectedResource:new URL('/mcp',c.base),resourceMetadataUrl:getOAuthProtectedResourceMetadataUrl(new URL('/mcp',c.base))}),async(req,res)=>{
  const server=makeMcp(recorder,download),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{transport.close().catch(()=>{});server.close().catch(()=>{})});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body)}catch{if(!res.headersSent)res.status(500).json({error:'MCP request failed.'})}
 });
 app.use('/api',localAuth);app.use('/api',sameOriginForWrites);
 function sameOriginForWrites(req,res,next){if(req.method==='GET')return next();return sameOrigin(req,res,next)}
 const handle=fn=>async(req,res)=>{try{res.json(await fn(req,res))}catch(e){res.status(400).json({error:e.message})}};
 app.get('/api/status',handle(()=>recorder.status()));
 app.post('/api/start',handle(req=>recorder.start(Start.parse(req.body))));
 app.post('/api/action',handle(req=>recorder.action(Action.parse(req.body))));
 app.post('/api/stop',handle(async()=>{const r=await recorder.stop();return {...r,downloadUrl:download(r)}}));
 app.get('/api/outline',handle(async()=>{const s=await recorder.snapshot();return {url:s.url,outline:s.outline}}));
 app.get('/api/screenshot',async(_req,res)=>{try{res.type('png').send((await recorder.snapshot()).image)}catch{res.status(400).json({error:'Start a recording first.'})}});
 app.get('/download/:token',async(req,res)=>{const d=auth.downloads.get(req.params.token);if(!d||d.expiresAt<Date.now())return res.status(404).send('Download link expired.');if(!/^[\da-f-]{36}$/.test(d.id)||!['mp4','webm'].includes(d.format))return res.sendStatus(404);const file=join(c.output,d.id,'workflow.'+d.format);try{await access(file);res.download(file,'Align_Workflow.'+d.format)}catch{res.status(404).send('Recording is no longer available.')}});
 app.use((err,_req,res,_next)=>{if(!res.headersSent)res.status(400).json({error:'Invalid request.'})});
 return {app,auth,recorder,async close(){clearInterval(clean);auth.close();if(recorder.session&&!recorder.busy)await recorder.stop().catch(()=>{})}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const c=config(),service=createApp(c);const server=service.app.listen(c.port,'0.0.0.0',()=>console.error('Recorder ready on port '+c.port));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await service.close();server.close(()=>process.exit(0))})}
