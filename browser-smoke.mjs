// Uses an actual isolated Chromium and a loopback-only synthetic fixture.
// Run on the cloud host / Docker image where the matching browser is installed.
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Recorder} from './recorder.mjs';
const http=createServer((_q,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><h1>Fictional workflow test</h1><label>Your name<input aria-label="Your name"></label><button onclick="document.querySelector(\'p\').textContent=\'Application received\'">Apply</button><p>Ready</p><div style="height:1400px"></div></body></html>')});await new Promise(r=>http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+http.address().port,dir=await mkdtemp(join(tmpdir(),'real-recorder-')),rec=new Recorder({origins:[url],allowLoopback:true,output:dir});
try{await rec.start({url,width:1280,height:720});await rec.action({action:'type',target:{label:'Your name'},text:'Fictional Candidate'});await rec.action({action:'click',target:{role:'button',name:'Apply'}});assert.match((await rec.snapshot()).outline,/Application received/);await rec.action({action:'scroll',pixels:250});await rec.action({action:'wait',seconds:1});const result=await rec.stop();assert((await readFile(join(dir,result.id,'workflow.'+result.format))).length>1000);console.log('Actual browser click/type/scroll recording passed:',result.format)}finally{if(rec.session)await rec.stop().catch(()=>{});await new Promise(r=>http.close(r));await rm(dir,{recursive:true,force:true})}
