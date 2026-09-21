// Run with: node run-lab.cjs baseline|pass|chaos|fail [unique-evidence-name]
// Owns only its child server. Never finds or stops another process by port/name.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const mode = process.argv[2];
const name = process.argv[3] || mode;
if (!['baseline', 'pass', 'chaos', 'fail'].includes(mode) || !/^[a-z0-9-]+$/.test(name)) {
  throw Error('Usage: node run-lab.cjs baseline|pass|chaos|fail [unique-evidence-name]');
}
process.chdir(__dirname);
fs.mkdirSync('results', { recursive: true });
const prefix = `results/${name}`;
for (const ext of ['txt','json','events.json','server.txt']) {
  if(fs.existsSync(`${prefix}.${ext}`)) throw Error(`Refusing to replace ${prefix}.${ext}`);
}
const outputFd = fs.openSync(`${prefix}.txt`, 'wx');
const serverFd = fs.openSync(`${prefix}.server.txt`, 'wx');
const events = [];
let server, k6, chaosTimer, closed = false;
let chaosTask = Promise.resolve();
const started = performance.now();
function event(type, extra = {}) {
  const entry = { at: new Date().toISOString(), elapsedMs: performance.now()-started, type, ...extra };
  events.push(entry);
  fs.writeFileSync(`${prefix}.events.json`, JSON.stringify(events,null,2)+'\n');
  console.log('EVENT', JSON.stringify(entry));
}
function write(text, stream = process.stdout) {
  fs.writeSync(outputFd, text);
  stream.write(text);
}
async function startServer() {
  return new Promise((resolve,reject) => {
    const child = spawn(process.execPath,['server.js'],{cwd:__dirname,windowsHide:true});
    server = child;
    const timer = setTimeout(()=>reject(Error('Server startup timed out')),10000);
    let ready = false;
    child.stdout.on('data',chunk=>{
      fs.writeSync(serverFd,chunk); process.stdout.write(chunk);
      if(!ready && chunk.toString().includes('API http://127.0.0.1:3000')) {
        ready=true; clearTimeout(timer); event('server_ready',{pid:child.pid}); resolve(child);
      }
    });
    child.stderr.on('data',chunk=>{fs.writeSync(serverFd,chunk); process.stderr.write(chunk);});
    child.once('error',err=>{clearTimeout(timer);reject(err);});
    child.once('exit',(code,signal)=>{
      clearTimeout(timer); event('server_exited',{pid:child.pid,code,signal});
      if(!ready)reject(Error('Server exited before becoming ready; check for an occupied port'));
    });
  });
}
async function stopServer(reason) {
  if(!server || server.exitCode!==null || server.signalCode!==null)return;
  const child=server;
  event('server_stop_requested',{pid:child.pid,reason});
  const exited=once(child,'close');
  child.kill(); // Actual child process termination on Windows.
  await exited;
  event('server_stopped',{pid:child.pid,reason});
}
async function main() {
  await startServer();
  const script=mode==='baseline'?'baseline.js':mode==='fail'?'slo-test-fail.js':'slo-test.js';
  const args=['run','--no-color','--summary-mode','full','--summary-export',`${prefix}.json`];
  if(mode==='chaos')args.push('--duration','2m','-e','CHAOS=1');
  args.push(script);
  write(`Run: ${name}\nMode: ${mode}\nStarted: ${new Date().toISOString()}\nGit HEAD: ${execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}\nCommand: k6 ${args.join(' ')}\n`);
  k6=spawn('k6',args,{cwd:__dirname,windowsHide:true});
  event('k6_started',{pid:k6.pid,args});
  k6.stdout.on('data',chunk=>write(chunk));
  k6.stderr.on('data',chunk=>write(chunk,process.stderr));
  if(mode==='chaos')chaosTimer=setTimeout(()=>{
    chaosTask=(async()=>{
      if(closed)throw Error('k6 stopped before the planned interruption');
      await stopServer('chaos');
      const pauseStart=performance.now();
      await new Promise(resolve=>setTimeout(resolve,10000));
      event('restart_requested',{confirmedStopToRestartMs:performance.now()-pauseStart,k6StillRunning:!closed});
      if(closed)throw Error('k6 stopped during the interruption');
      await startServer();
    })();
    // Record rejection now, and rethrow when awaited below.
    chaosTask.catch(error=>event('chaos_error',{message:error.message}));
  },30000);
  const [code,signal]=await once(k6,'close');
  closed=true; clearTimeout(chaosTimer);
  // Native exit code from this exact child; no pipeline or shell Boolean involved.
  write(`\nFinished: ${new Date().toISOString()}\nk6 exit code: ${code}\nk6 signal: ${signal}\n`);
  event('k6_exited',{pid:k6.pid,code,signal});
  await chaosTask;
  await stopServer('run complete');
  process.exitCode=code===null?1:code;
}
main().catch(async error=>{
  console.error(error); event('runner_error',{message:error.message});
  if(k6 && !closed)k6.kill();
  await stopServer('runner error'); process.exitCode=1;
}).finally(()=>{fs.closeSync(outputFd);fs.closeSync(serverFd);});
