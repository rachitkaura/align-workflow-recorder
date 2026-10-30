import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {Recorder} from './recorder.mjs';
import {makeMcp} from './tools.mjs';
const recorder=new Recorder({origins:(process.env.ALLOWED_ORIGINS||'https://align-career-match-rk.rkaura94.chatgpt.site').split(',').map(x=>new URL(x.trim()).origin),output:process.env.OUTPUT_DIR||'./recordings'});
const server=makeMcp(recorder);await server.connect(new StdioServerTransport());
async function close(){if(recorder.session&&!recorder.busy)await recorder.stop().catch(()=>{});await server.close();process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close);process.stdin.on('end',close);
