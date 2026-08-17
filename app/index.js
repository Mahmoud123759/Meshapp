'use strict';
// tracing.js is loaded via NODE_OPTIONS=--require ./tracing.js

const http         = require('http');
const { trace, context, propagation } = require('@opentelemetry/api');
const client       = require('prom-client');
const { Client }   = require('pg');

const SERVICE_NAME = process.env.SERVICE_NAME || 'meshapp-unknown';
const PORT         = parseInt(process.env.PORT || '3000');

let pgClient = null;
if (process.env.DB_HOST) {
  pgClient = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
      rejectUnauthorized: false,
    },
  });
  pgClient.connect()
    .then(async () => {
      console.log('Connected to PostgreSQL');
      await pgClient.query('CREATE TABLE IF NOT EXISTS test_data (id SERIAL PRIMARY KEY, request_time TIMESTAMP, status VARCHAR(50))');
      console.log('Database schema initialized');
    })
    .catch(e => console.error('PG Connect Error', e));
}

const UI_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MeshApp Interactive</title>
  <style>
    body { font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 2rem; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .container { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); width: 100%; max-width: 600px; }
    h1 { margin-top: 0; color: #38bdf8; }
    .btn { display: block; width: 100%; padding: 1rem; margin-bottom: 1rem; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: transform 0.1s, opacity 0.2s; font-weight: 600; }
    .btn:active { transform: scale(0.98); }
    .btn:hover { opacity: 0.9; }
    .btn-green { background: #10b981; color: white; }
    .btn-red { background: #ef4444; color: white; }
    .btn-yellow { background: #f59e0b; color: white; }
    .btn-gray { background: #64748b; color: white; }
    .test-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    .test-row .btn { margin-bottom: 0; flex: 1; }
    .toggle-container { display: flex; align-items: center; gap: 0.5rem; background: #334155; padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.8rem; }
    #result { margin-top: 1rem; padding: 1rem; background: #0f172a; border-radius: 8px; font-family: monospace; white-space: pre-wrap; word-break: break-all; min-height: 100px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>MeshApp Interactive Tests</h1>
    
    <div class="test-row">
      <button class="btn btn-green" onclick="runTest('healthy')">🚀 Healthy Request (Insert DB)</button>
      <label class="toggle-container"><input type="checkbox" onchange="toggleAuto('healthy', this)"> Auto (5 rps)</label>
    </div>

    <div class="test-row">
      <button class="btn btn-red" onclick="runTest('db-bad-request')">💥 DB Bad Request (Invalid Query)</button>
      <label class="toggle-container"><input type="checkbox" onchange="toggleAuto('db-bad-request', this)"> Auto (5 rps)</label>
    </div>

    <div class="test-row">
      <button class="btn btn-yellow" onclick="runTest('db-slow-query')">🐢 DB Slow Query (pg_sleep)</button>
      <label class="toggle-container"><input type="checkbox" onchange="toggleAuto('db-slow-query', this)"> Auto (5 rps)</label>
    </div>

    <div class="test-row">
      <button class="btn btn-yellow" onclick="runTest('stress-latency')">🐌 Stress: Latency (Node.js)</button>
      <label class="toggle-container"><input type="checkbox" onchange="toggleAuto('stress-latency', this)"> Auto (5 rps)</label>
    </div>

    <div class="test-row">
      <button class="btn btn-red" onclick="runTest('stress-cpu')">🔥 Stress: CPU Burn (Pyroscope)</button>
      <label class="toggle-container"><input type="checkbox" onchange="toggleAuto('stress-cpu', this)"> Auto (5 rps)</label>
    </div>

    <hr style="border: 0; border-top: 1px solid #334155; margin: 1.5rem 0;">
    
    <button class="btn btn-gray" onclick="runTest('healthy', 20)">⚙️ Test Env Vars (Send 20 Requests)</button>

    <div id="result">Results will appear here...</div>
  </div>
  <script>
    const timers = {};

    async function runTest(type, count = 1) {
      const resEl = document.getElementById('result');
      if (count === 1) resEl.textContent = 'Running ' + type + '...';
      
      for (let i = 0; i < count; i++) {
        try {
          const start = Date.now();
          const res = await fetch('/status', { headers: { 'x-test-type': type } });
          const data = await res.json();
          if (count === 1) {
            data._client_latency_ms = Date.now() - start;
            resEl.textContent = JSON.stringify(data, null, 2);
          }
        } catch (e) {
          if (count === 1) resEl.textContent = 'Error: ' + e.message;
        }
      }
      if (count > 1) resEl.textContent = 'Sent ' + count + ' requests to test environment variables.';
    }

    function toggleAuto(type, checkbox) {
      if (checkbox.checked) {
        timers[type] = setInterval(() => runTest(type), 200); // 5 rps
      } else {
        clearInterval(timers[type]);
        delete timers[type];
      }
    }
  </script>
</body>
</html>
`;

const register = new client.Registry();
register.setDefaultLabels({ service: SERVICE_NAME });
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name:   'meshapp_http_requests_total',
  help:   'Total HTTP requests received',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});
const httpRequestDuration = new client.Histogram({
  name:    'meshapp_http_request_duration_seconds',
  help:    'HTTP request latency',
  labelNames: ['route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});
const downstreamErrors = new client.Counter({
  name:   'meshapp_downstream_errors_total',
  help:   'Downstream call failures',
  labelNames: ['target'],
  registers: [register],
});
const downstreamLatency = new client.Histogram({
  name:    'meshapp_downstream_latency_seconds',
  help:    'Latency of downstream HTTP probes',
  labelNames: ['target'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

const log = (msg, level = 'info', extra = {}) => {
  const span = trace.getActiveSpan();
  const entry = {
    time:       new Date().toISOString(),
    level,
    service:    SERVICE_NAME,
    pod:        process.env.POD_NAME,
    msg,
    trace_id:   span ? span.spanContext().traceId  : undefined,
    span_id:    span ? span.spanContext().spanId   : undefined,
    ...extra,
  };
  Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);
  console.log(JSON.stringify(entry));

  if (process.env.STRESS_LOG_BURST > 0) {
    for (let i = 0; i < parseInt(process.env.STRESS_LOG_BURST); i++) {
      console.log(JSON.stringify({ ...entry, msg: `Flood entry ${i}`, stress: true }));
    }
  }
};

const probe = (target, incomingHeaders) => {
  return new Promise((resolve) => {
    const start = Date.now();
    const [host, port] = target.includes(':') ? target.split(':') : [target, '3000'];

    const outHeaders = { 'content-type': 'application/json' };
    if (incomingHeaders['x-test-type']) {
      outHeaders['x-test-type'] = incomingHeaders['x-test-type'];
    }
    propagation.inject(context.active(), outHeaders);

    const req = http.get(
      { host, port: parseInt(port), path: '/status', headers: outHeaders },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const elapsed = (Date.now() - start) / 1000;
          downstreamLatency.labels(target).observe(elapsed);
          try {
            resolve({ ...JSON.parse(data), latency_ms: Date.now() - start });
          } catch {
            resolve({ status: 'ERROR', target, latency_ms: Date.now() - start });
          }
        });
      }
    );
    req.on('error', (e) => {
      const elapsed = (Date.now() - start) / 1000;
      downstreamLatency.labels(target).observe(elapsed);
      downstreamErrors.labels(target).inc();
      resolve({ status: 'DOWN', target, error: e.message, latency_ms: Date.now() - start });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      downstreamErrors.labels(target).inc();
      resolve({ status: 'TIMEOUT', target, latency_ms: 5000 });
    });
  });
};

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const tracer = trace.getTracer(SERVICE_NAME);

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME }));
  }

  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    return res.end(await register.metrics());
  }

  const errorRate = parseInt(process.env.STRESS_ERROR_RATE || '0');
  if (errorRate > 0 && Math.random() * 100 < errorRate) {
    httpRequestsTotal.labels('GET', req.url, '500').inc();
    httpRequestDuration.labels(req.url).observe((Date.now() - start) / 1000);
    log('Chaos error injected', 'error', { url: req.url });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ERROR', message: 'Chaos Injected' }));
  }

  if (process.env.STRESS_CPU_BURN_MS > 0) {
    const limit = Date.now() + parseInt(process.env.STRESS_CPU_BURN_MS);
    while (Date.now() < limit) { /* busy-loop */ }
  }

  if (process.env.STRESS_LATENCY_MS > 0) {
    await new Promise(r => setTimeout(r, parseInt(process.env.STRESS_LATENCY_MS)));
  }

  if (req.url === '/' && SERVICE_NAME === 'meshapp-ingress-gw') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(UI_HTML);
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!urlObj.pathname.startsWith('/status')) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  return tracer.startActiveSpan(`${SERVICE_NAME}.handle`, async (span) => {
    try {
      const testType = req.headers['x-test-type'] || urlObj.searchParams.get('test') || 'healthy';
      span.setAttribute('test.type', testType);
      
      if (testType === 'stress-latency') {
        await new Promise(r => setTimeout(r, 200));
      } else if (testType === 'stress-cpu') {
        const limit = Date.now() + 500;
        let sum = 0;
        while (Date.now() < limit) {
          sum += Math.sqrt(Math.random() * 1000);
        }
      }

      span.setAttribute('http.url',    req.url);
      span.setAttribute('service',     SERVICE_NAME);
      span.setAttribute('pod',         process.env.POD_NAME || '');

      const downstreams = (process.env.DOWNSTREAM_SERVICES || '')
        .split(',').map(s => s.trim()).filter(Boolean);

      const results = await Promise.all(
        downstreams.map(svc => probe(svc, req.headers))
      );

      if (downstreams.length === 0 && pgClient) {
        if (testType === 'db-bad-request') {
          try {
            await pgClient.query('SELECT * FROM non_existent_table_for_bad_request');
          } catch(e) {
            span.recordException(e);
          }
        } else if (testType === 'db-slow-query') {
           await pgClient.query('SELECT pg_sleep(3)');
        } else {
           await pgClient.query('INSERT INTO test_data (request_time, status) VALUES (NOW(), $1)', ['healthy']);
        }
      }

      const allUp    = results.every(r => r.status === 'UP');
      const anyUp    = results.some(r => r.status === 'UP');
      const status   = downstreams.length === 0 ? 'UP'
                     : allUp  ? 'UP'
                     : anyUp  ? 'PARTIAL'
                     : 'DOWN';
      const duration = Date.now() - start;

      span.setAttribute('mesh.status', status);
      span.setAttribute('mesh.downstream_count', downstreams.length);
      span.setAttribute('mesh.latency_ms', duration);

      log(`Handled ${req.url}`, status === 'UP' ? 'info' : 'warn', { status, duration_ms: duration });

      httpRequestsTotal.labels('GET', req.url, '200').inc();
      httpRequestDuration.labels(req.url).observe(duration / 1000);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status,
        service: SERVICE_NAME,
        pod:     process.env.POD_NAME,
        results,
        latency_ms: duration,
        time: new Date().toISOString(),
      }));
    } catch (err) {
      span.recordException(err);
      log('Unhandled error', 'error', { error: err.message });
      httpRequestsTotal.labels('GET', req.url, '500').inc();
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
    } finally {
      span.end();
    }
  });
});

server.listen(PORT, () => log(`${SERVICE_NAME} listening on :${PORT}`));