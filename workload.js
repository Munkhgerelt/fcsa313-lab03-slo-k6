import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

export const recoveryMs = new Trend('recovery_ms', true);
export const recoveryEvents = new Counter('recovery_events');
let failureObservedAt = null;
let recordedRecovery = false;

export const commonOptions = {
  vus: 20,
  duration: '1m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  // Fixed loopback address: this workload cannot target an external server.
  const base = 'http://127.0.0.1:3000';
  const c = http.post(`${base}/cart/add`, null, { tags: { name: 'cart' } });
  // One observer, using existing workload requests: no extra probes or checks.
  if (__ENV.CHAOS === '1' && __VU === 1 && !recordedRecovery) {
    const now = Date.now();
    if (c.status === 0 && failureObservedAt === null) {
      failureObservedAt = now;
      console.log(`RECOVERY_START ${JSON.stringify({vu: 1, at: new Date(now).toISOString(), epochMs: now, status: c.status, errorCode: c.error_code})}`);
    } else if (c.status === 200 && failureObservedAt !== null) {
      const elapsedMs = now - failureObservedAt;
      recoveryMs.add(elapsedMs);
      recoveryEvents.add(1);
      recordedRecovery = true;
      console.log(`RECOVERY_END ${JSON.stringify({vu: 1, at: new Date(now).toISOString(), epochMs: now, elapsedMs})}`);
    }
  }
  const r = http.get(`${base}/report`, { tags: { name: 'report' } });
  const p = http.post(`${base}/pay`, null, { tags: { name: 'pay' } });
  // Exactly one HTTP-200 check for each of the three measured requests.
  check(c, { 'cart 200': x => x.status === 200 });
  check(r, { 'report 200': x => x.status === 200 });
  check(p, { 'pay 200': x => x.status === 200 });
  sleep(1);
}
