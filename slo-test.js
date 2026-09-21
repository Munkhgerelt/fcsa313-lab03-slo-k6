import workload, { commonOptions } from './workload.js';

export const options = {
  ...commonOptions,
  thresholds: {
    'http_req_duration{name:cart}': ['p(95)<1.235'],
    'http_req_duration{name:report}': ['p(95)<450'],
    'http_req_duration{name:pay}': [], // p95/p99 are reported, without a latency SLO.
    'http_req_failed{name:pay}': ['rate<0.08'],
    checks: ['rate>=0.90'],
    ...(__ENV.CHAOS === '1' ? {
      recovery_ms: ['max<15000'],
      recovery_events: ['count==1'],
    } : {}),
  },
};
export default workload;
