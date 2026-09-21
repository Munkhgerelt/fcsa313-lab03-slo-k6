import workload, { commonOptions } from './workload.js';
export const options = {
  ...commonOptions,
  // Empty threshold lists expose endpoint submetrics without imposing a target.
  thresholds: {
    'http_req_duration{name:cart}': [],
    'http_req_duration{name:report}': [],
    'http_req_duration{name:pay}': [],
    'http_req_failed{name:pay}': [],
  },
};
export default workload;
