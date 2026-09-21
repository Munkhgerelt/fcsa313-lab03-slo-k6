const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
process.chdir(__dirname);
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const runs = {};
for (const name of ['baseline', 'pass-initial', 'chaos-initial', 'pass', 'chaos', 'fail']) {
  const m = read(`results/${name}.json`).metrics;
  const output = fs.readFileSync(`results/${name}.txt`, 'utf8');
  const cart = m['http_req_duration{name:cart}'];
  const report = m['http_req_duration{name:report}'];
  const pay = m['http_req_duration{name:pay}'];
  const payError = m['http_req_failed{name:pay}'];
  const exitCode = Number(output.match(/k6 exit code: (\d+)/)[1]);
  assert.equal(m.checks.passes + m.checks.fails, m.http_reqs.count, `${name}: check denominator`);
  assert.equal(cart.count + report.count + pay.count, m.http_reqs.count);
  assert.equal(payError.passes + payError.fails, pay.count);
  assert.ok(output.includes('execution: local') && output.includes('running (0m01.0s)') && output.includes('TOTAL RESULTS'), `${name}: full output`);
  assert.ok(output.includes('0 interrupted iterations'));
  if(name !== 'baseline') {
    // k6 legacy JSON uses true for a crossed (failed) threshold, false for passed.
    assert.equal(cart.thresholds['p(95)<1.235'], !(cart['p(95)'] < 1.235));
    const reportLimit = name === 'fail' ? 100 : 450;
    assert.equal(report.thresholds[`p(95)<${reportLimit}`], !(report['p(95)'] < reportLimit));
    assert.equal(payError.thresholds['rate<0.08'], !(payError.value < .08));
    assert.equal(m.checks.thresholds['rate>=0.90'], !(m.checks.value >= .90));
  }
  const failed = Object.entries(m).flatMap(([metric,v]) => Object.entries(v.thresholds || {}).filter(([,bad])=>bad).map(([expr])=>`${metric}: ${expr}`));
  assert.equal(exitCode, failed.length ? 99 : 0);
  if(name === 'pass') assert.deepEqual(failed, []);
  if(name === 'fail') assert.deepEqual(failed, ['http_req_duration{name:report}: p(95)<100']);
  runs[name] = {
    requests:m.http_reqs.count, requestsPerSecond:m.http_reqs.rate,
    successes:m.checks.passes, failures:m.checks.fails,
    availabilityPercent:100*m.checks.passes/m.http_reqs.count,
    payFailures:payError.passes, payRequests:pay.count, payErrorPercent:100*payError.value,
    cartP95Ms:cart['p(95)'], cartP99Ms:cart['p(99)'],
    reportP95Ms:report['p(95)'], reportP99Ms:report['p(99)'],
    payP95Ms:pay['p(95)'], payP99Ms:pay['p(99)'], exitCode, failedThresholds:failed,
    ...(m.recovery_ms ? {recoveryMs:m.recovery_ms.max} : {}),
  };
}
const events = read('results/chaos.events.json');
const stopped = events.find(e=>e.type==='server_stopped' && e.reason==='chaos');
const restart = events.find(e=>e.type==='restart_requested');
const ready = events.filter(e=>e.type==='server_ready')[1];
assert.notEqual(stopped.pid, ready.pid);
assert.equal(restart.k6StillRunning, true);
assert.ok(restart.confirmedStopToRestartMs >= 10000);
const chaos = read('results/chaos.json').metrics;
assert.equal(chaos.recovery_events.count, 1);
assert.ok(chaos.recovery_ms.max < 15000);
assert.equal(chaos.recovery_ms.count, 1);
const output = fs.readFileSync('results/chaos.txt','utf8');
assert.ok(output.includes('RECOVERY_START') && output.includes('RECOVERY_END') && output.includes('actively refused'));
const transportFailures = {cart:0,report:0,pay:0};
for(const line of output.split('\n')) if(line.includes('level=warning') && line.includes('Request Failed')) {
  for(const [tag,path] of Object.entries({cart:'/cart/add',report:'/report',pay:'/pay'})) {
    if(line.includes('3000'+path)) transportFailures[tag]++;
  }
}
const calculations = {
  cartBaselineTimes1point5:runs.baseline.cartP95Ms*1.5,
  cartThresholdRoundedUpMs:Math.ceil(runs.baseline.cartP95Ms*1500)/1000,
  timeBudgetSeconds:12,
  requestBudgetExact:runs.chaos.requests*.1,
  requestBudgetWhole:Math.floor(runs.chaos.requests*.1),
  minimumSuccessfulRequests:Math.ceil(runs.chaos.requests*.9),
  excessFailedRequests:runs.chaos.failures-Math.floor(runs.chaos.requests*.1),
  confirmedStopToRestartRequestMs:restart.confirmedStopToRestartMs,
  confirmedStopToReadyMs:ready.elapsedMs-stopped.elapsedMs,
  transportFailures,
  payHttp500Failures:runs.chaos.payFailures-transportFailures.pay,
};
assert.equal(calculations.cartThresholdRoundedUpMs, 1.235);
const readme = fs.readFileSync('README.md','utf8');
for(const script of ['slo-test.js','slo-test-fail.js']) {
  const options=JSON.parse(execFileSync('k6',['inspect','-e','CHAOS=1',script],{encoding:'utf8'}));
  for(const expressions of Object.values(options.thresholds)) for(const expr of expressions) assert.ok(readme.includes('`'+expr+'`'),`README missing ${expr}`);
}
for(const label of ['Тойм','Системийн төлөв','Орчны төлөв','Гадаад өдөөлт','Шаардлагатай хариу','Хэмжүүр']) {
  assert.equal(readme.split(`| ${label} |`).length-1, 4, label);
}
for(const name of ['baseline','pass','chaos','fail']) {
  for(const field of ['requestsPerSecond','availabilityPercent','payErrorPercent','cartP95Ms','cartP99Ms','reportP95Ms','reportP99Ms','payP95Ms','payP99Ms']) {
    assert.ok(readme.includes(runs[name][field].toFixed(6)), `README measurement ${name}/${field}`);
  }
}
const conclusion=readme.split('## Дүгнэлт\n')[1].split('\n\nЭнэ дүгнэлт')[0].trim().split('\n');
assert.equal(conclusion.length,9);
const result={runs,calculations,source:'Derived from corresponding k6 JSON/text outputs and chaos process-event timestamps.'};
fs.writeFileSync('results/calculations.json',JSON.stringify(result,null,2)+'\n');
console.log('VERIFIED: all 6 runs, native exit codes, check denominators, threshold results, real chaos process replacement, recovery, four scenario tables and README threshold expressions.');
console.log(JSON.stringify(calculations,null,2));
