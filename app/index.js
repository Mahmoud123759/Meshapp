'use strict';

// tracing.js is loaded via:
// NODE_OPTIONS=--require ./tracing.js

const http = require('http');
const { trace, context, propagation } = require('@opentelemetry/api');
const client = require('prom-client');
const { Client } = require('pg');

const SERVICE_NAME = process.env.SERVICE_NAME || 'meshapp-unknown';
const PORT = parseInt(process.env.PORT || '3000', 10);

// ============================================================
// PostgreSQL
// ============================================================

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

  pgClient
    .connect()
    .then(async () => {
      console.log('Connected to PostgreSQL');

      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS test_data (
          id SERIAL PRIMARY KEY,
          request_time TIMESTAMP,
          status VARCHAR(50)
        )
      `);

      console.log('Database schema initialized');
    })
    .catch((err) => {
      console.error('PG Connect Error', err);
    });
}

// ============================================================
// UI
// ============================================================

const UI_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MeshApp Interactive</title>
  <style>
    body {
      font-family: 'Inter', sans-serif;
      background: #0f172a;
      color: #f8fafc;
      margin: 0;
      padding: 2rem;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }

    .container {
      background: #1e293b;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      width: 100%;
      max-width: 600px;
    }

    h1 {
      margin-top: 0;
      color: #38bdf8;
    }

    .btn {
      display: block;
      width: 100%;
      padding: 1rem;
      margin-bottom: 1rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.1s, opacity 0.2s;
      font-weight: 600;
    }

    .btn:active {
      transform: scale(0.98);
    }

    .btn:hover {
      opacity: 0.9;
    }

    .btn-green {
      background: #10b981;
      color: white;
    }

    .btn-red {
      background: #ef4444;
      color: white;
    }

    .btn-yellow {
      background: #f59e0b;
      color: white;
    }

    .btn-gray {
      background: #64748b;
      color: white;
    }

    .test-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .test-row .btn {
      margin-bottom: 0;
      flex: 1;
    }

    .toggle-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #334155;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.8rem;
    }

    #result {
      margin-top: 1rem;
      padding: 1rem;
      background: #0f172a;
      border-radius: 8px;
      font-family: monospace;
      white-space: pre-wrap;
      word-break: break-all;
      min-height: 100px;
    }
  </style>
</head>

<body>
  <div class="container">
    <h1>MeshApp Interactive Tests</h1>

    <div class="test-row">
      <button class="btn btn-green"
              onclick="runTest('healthy')">
        🚀 Healthy Request (Insert DB)
      </button>

      <label class="toggle-container">
        <input type="checkbox"
               onchange="toggleAuto('healthy', this)">
        Auto (5 rps)
      </label>
    </div>

    <div class="test-row">
      <button class="btn btn-red"
              onclick="runTest('db-bad-request')">
        💥 DB Bad Request (Invalid Query)
      </button>

      <label class="toggle-container">
        <input type="checkbox"
               onchange="toggleAuto('db-bad-request', this)">
        Auto (5 rps)
      </label>
    </div>

    <div class="test-row">
      <button class="btn btn-yellow"
              onclick="runTest('db-slow-query')">
        🐢 DB Slow Query (pg_sleep)
      </button>

      <label class="toggle-container">
        <input type="checkbox"
               onchange="toggleAuto('db-slow-query', this)">
        Auto (5 rps)
      </label>
    </div>

    <div class="test-row">
      <button class="btn btn-yellow"
              onclick="runTest('stress-latency')">
        🐌 Stress: Latency (Node.js)
      </button>

      <label class="toggle-container">
        <input type="checkbox"
               onchange="toggleAuto('stress-latency', this)">
        Auto (5 rps)
      </label>
    </div>

    <div class="test-row">
      <button class="btn btn-red"
              onclick="runTest('stress-cpu')">
        🔥 Stress: CPU Burn (Pyroscope)
      </button>

      <label class="toggle-container">
        <input type="checkbox"
               onchange="toggleAuto('stress-cpu', this)">
        Auto (5 rps)
      </label>
    </div>

    <hr style="border: 0; border-top: 1px solid #334155; margin: 1.5rem 0;">

    <button class="btn btn-gray"
            onclick="runTest('healthy', 20)">
      ⚙️ Test Env Vars (Send 20 Requests)
    </button>

    <div id="result">Results will appear here...</div>
  </div>

  <script>
    const timers = {};

    async function runTest(type, count = 1) {
      const resEl = document.getElementById('result');

      if (count === 1) {
        resEl.textContent = 'Running ' + type + '...';
      }

      for (let i = 0; i < count; i++) {
        try {
          const start = Date.now();

          const res = await fetch('/status', {
            headers: {
              'x-test-type': type
            }
          });

          const data = await res.json();

          if (count === 1) {
            data._client_latency_ms = Date.now() - start;
            resEl.textContent = JSON.stringify(data, null, 2);
          }
        } catch (e) {
          if (count === 1) {
            resEl.textContent = 'Error: ' + e.message;
          }
        }
      }

      if (count > 1) {
        resEl.textContent =
          'Sent ' + count + ' requests to test environment variables.';
      }
    }

    function toggleAuto(type, checkbox) {
      if (checkbox.checked) {
        timers[type] = setInterval(() => {
          runTest(type);
        }, 200);
      } else {
        clearInterval(timers[type]);
        delete timers[type];
      }
    }
  </script>
</body>
</html>
`;

// ============================================================
// Prometheus metrics
// ============================================================

const register = new client.Registry();

register.setDefaultLabels({
  service: SERVICE_NAME,
});

client.collectDefaultMetrics({
  register,
});

const httpRequestsTotal = new client.Counter({
  name: 'meshapp_http_requests_total',
  help: 'Total HTTP requests received',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'meshapp_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['route'],
  buckets: [
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5,
  ],
  registers: [register],
});

const downstreamErrors = new client.Counter({
  name: 'meshapp_downstream_errors_total',
  help: 'Downstream call failures',
  labelNames: ['target'],
  registers: [register],
});

const downstreamLatency = new client.Histogram({
  name: 'meshapp_downstream_latency_seconds',
  help: 'Latency of downstream HTTP probes',
  labelNames: ['target'],
  buckets: [
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5,
  ],
  registers: [register],
});

// ============================================================
// Structured logging
// ============================================================

const log = (msg, level = 'info', extra = {}) => {
  const span = trace.getActiveSpan();

  const entry = {
    time: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    pod: process.env.POD_NAME,
    msg,
    trace_id: span
      ? span.spanContext().traceId
      : undefined,
    span_id: span
      ? span.spanContext().spanId
      : undefined,
    ...extra,
  };

  Object.keys(entry).forEach((key) => {
    if (entry[key] === undefined) {
      delete entry[key];
    }
  });

  console.log(JSON.stringify(entry));

  const burst = parseInt(
    process.env.STRESS_LOG_BURST || '0',
    10
  );

  if (burst > 0) {
    for (let i = 0; i < burst; i++) {
      console.log(
        JSON.stringify({
          ...entry,
          msg: `Flood entry ${i}`,
          stress: true,
        })
      );
    }
  }
};

// ============================================================
// Downstream HTTP probe
// ============================================================

const probe = (target, incomingHeaders) => {
  return new Promise((resolve) => {
    const start = Date.now();

    const parts = target.split(':');

    const host = parts[0];
    const port = parseInt(parts[1] || '3000', 10);

    const outHeaders = {
      'content-type': 'application/json',
    };

    if (incomingHeaders['x-test-type']) {
      outHeaders['x-test-type'] =
        incomingHeaders['x-test-type'];
    }

    propagation.inject(
      context.active(),
      outHeaders
    );

    const req = http.get(
      {
        host,
        port,
        path: '/status',
        headers: outHeaders,
      },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const elapsed =
            (Date.now() - start) / 1000;

          downstreamLatency
            .labels(target)
            .observe(elapsed);

          try {
            resolve({
              ...JSON.parse(data),
              latency_ms: Date.now() - start,
            });
          } catch {
            resolve({
              status: 'ERROR',
              target,
              latency_ms: Date.now() - start,
            });
          }
        });
      }
    );

    req.on('error', (err) => {
      const elapsed =
        (Date.now() - start) / 1000;

      downstreamLatency
        .labels(target)
        .observe(elapsed);

      downstreamErrors
        .labels(target)
        .inc();

      resolve({
        status: 'DOWN',
        target,
        error: err.message,
        latency_ms: Date.now() - start,
      });
    });

    req.setTimeout(5000, () => {
      req.destroy();

      downstreamErrors
        .labels(target)
        .inc();

      resolve({
        status: 'TIMEOUT',
        target,
        latency_ms: 5000,
      });
    });
  });
};

// ============================================================
// HTTP server
// ============================================================

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const tracer = trace.getTracer(SERVICE_NAME);

  // ----------------------------------------------------------
  // Health
  // ----------------------------------------------------------

  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
    });

    return res.end(
      JSON.stringify({
        status: 'ok',
        service: SERVICE_NAME,
      })
    );
  }

  // ----------------------------------------------------------
  // Metrics
  // ----------------------------------------------------------

  if (req.url === '/metrics') {
    res.writeHead(200, {
      'Content-Type': register.contentType,
    });

    return res.end(
      await register.metrics()
    );
  }

  // ----------------------------------------------------------
  // Root UI
  // ----------------------------------------------------------

  if (
    req.url === '/' &&
    SERVICE_NAME === 'meshapp-ingress-gw'
  ) {
    res.writeHead(200, {
      'Content-Type': 'text/html',
    });

    return res.end(UI_HTML);
  }

  // ----------------------------------------------------------
  // Parse URL
  // ----------------------------------------------------------

  const urlObj = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (!urlObj.pathname.startsWith('/status')) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  // ----------------------------------------------------------
  // Chaos error
  // ----------------------------------------------------------

  const errorRate = parseInt(
    process.env.STRESS_ERROR_RATE || '0',
    10
  );

  if (
    errorRate > 0 &&
    Math.random() * 100 < errorRate
  ) {
    const httpStatus = 500;

    httpRequestsTotal
      .labels(
        req.method || 'GET',
        urlObj.pathname,
        String(httpStatus)
      )
      .inc();

    httpRequestDuration
      .labels(urlObj.pathname)
      .observe(
        (Date.now() - start) / 1000
      );

    log(
      'Chaos error injected',
      'error',
      {
        url: req.url,
      }
    );

    res.writeHead(httpStatus, {
      'Content-Type': 'application/json',
    });

    return res.end(
      JSON.stringify({
        status: 'ERROR',
        message: 'Chaos Injected',
      })
    );
  }

  // ----------------------------------------------------------
  // Request span
  // ----------------------------------------------------------

  return tracer.startActiveSpan(
    `${SERVICE_NAME}.handle`,
    async (span) => {
      try {
        span.setAttribute(
          'service.name',
          SERVICE_NAME
        );

        span.setAttribute(
          'deployment.environment',
          'meshapp'
        );

        span.setAttribute(
          'k8s.namespace.name',
          'meshapp'
        );

        span.setAttribute(
          'k8s.pod.name',
          process.env.POD_NAME || ''
        );

        const testType =
          req.headers['x-test-type'] ||
          urlObj.searchParams.get('test') ||
          'healthy';

        span.setAttribute(
          'test.type',
          testType
        );

        span.setAttribute(
          'http.url',
          req.url
        );

        span.setAttribute(
          'service',
          SERVICE_NAME
        );

        span.setAttribute(
          'pod',
          process.env.POD_NAME || ''
        );

        // ------------------------------------------------------
        // Test-specific stress
        // ------------------------------------------------------

        if (testType === 'stress-latency') {
          await new Promise((resolve) =>
            setTimeout(resolve, 200)
          );

          span.setAttribute(
            'stress.latency_ms',
            200
          );
        }

        if (testType === 'stress-cpu') {
          const burnMs = parseInt(
            process.env.STRESS_CPU_BURN_MS || '500',
            10
          );

          const end = Date.now() + burnMs;

          let value = 0;

          while (Date.now() < end) {
            value += Math.sqrt(
              Math.random() * 1000
            );
          }

          span.setAttribute(
            'stress.cpu_burn_ms',
            burnMs
          );

          span.setAttribute(
            'stress.cpu_result',
            value
          );
        }

        // ------------------------------------------------------
        // Global configured latency
        // ------------------------------------------------------

        const configuredLatency = parseInt(
          process.env.STRESS_LATENCY_MS || '0',
          10
        );

        if (configuredLatency > 0) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              configuredLatency
            )
          );
        }

        // ------------------------------------------------------
        // Downstream services
        // ------------------------------------------------------

        const downstreams = (
          process.env.DOWNSTREAM_SERVICES || ''
        )
          .split(',')
          .map((service) => service.trim())
          .filter(Boolean);

        const results = await Promise.all(
          downstreams.map((service) =>
            probe(service, req.headers)
          )
        );

        // ------------------------------------------------------
        // PostgreSQL
        // ------------------------------------------------------

        if (
          downstreams.length === 0 &&
          pgClient
        ) {
          if (testType === 'db-bad-request') {
            try {
              await pgClient.query(
                'SELECT * FROM non_existent_table_for_bad_request'
              );
            } catch (err) {
              span.recordException(err);

              span.setAttribute(
                'db.error',
                true
              );
            }
          } else if (
            testType === 'db-slow-query'
          ) {
            await pgClient.query(
              'SELECT pg_sleep(3)'
            );

            span.setAttribute(
              'db.sleep_seconds',
              3
            );
          } else {
            await pgClient.query(
              `INSERT INTO test_data
               (request_time, status)
               VALUES (NOW(), $1)`,
              ['healthy']
            );
          }
        }

        // ------------------------------------------------------
        // Mesh status
        // ------------------------------------------------------

        const allUp =
          results.length > 0 &&
          results.every(
            (result) =>
              result.status === 'UP'
          );

        const anyUp =
          results.some(
            (result) =>
              result.status === 'UP'
          );

        const status =
          downstreams.length === 0
            ? 'UP'
            : allUp
              ? 'UP'
              : anyUp
                ? 'PARTIAL'
                : 'DOWN';

        const duration =
          Date.now() - start;

        span.setAttribute(
          'mesh.status',
          status
        );

        span.setAttribute(
          'mesh.downstream_count',
          downstreams.length
        );

        span.setAttribute(
          'mesh.latency_ms',
          duration
        );

        // ------------------------------------------------------
        // Success response
        // ------------------------------------------------------

        const httpStatus = 200;

        log(
          `Handled ${req.url}`,
          status === 'UP'
            ? 'info'
            : 'warn',
          {
            status,
            duration_ms: duration,
          }
        );

        httpRequestsTotal
          .labels(
            req.method || 'GET',
            urlObj.pathname,
            String(httpStatus)
          )
          .inc();

        httpRequestDuration
          .labels(urlObj.pathname)
          .observe(
            duration / 1000
          );

        res.writeHead(httpStatus, {
          'Content-Type':
            'application/json',
        });

        return res.end(
          JSON.stringify({
            status,
            service: SERVICE_NAME,
            pod: process.env.POD_NAME,
            results,
            latency_ms: duration,
            time: new Date().toISOString(),
          })
        );
      } catch (err) {
        // ------------------------------------------------------
        // Unexpected error
        // ------------------------------------------------------

        span.recordException(err);

        log(
          'Unhandled error',
          'error',
          {
            error: err.message,
          }
        );

        const httpStatus = 500;

        httpRequestsTotal
          .labels(
            req.method || 'GET',
            urlObj.pathname,
            String(httpStatus)
          )
          .inc();

        httpRequestDuration
          .labels(urlObj.pathname)
          .observe(
            (Date.now() - start) / 1000
          );

        res.writeHead(httpStatus, {
          'Content-Type':
            'application/json',
        });

        return res.end(
          JSON.stringify({
            status: 'ERROR',
            error: err.message,
          })
        );
      } finally {
        span.end();
      }
    }
  );
});

// ============================================================
// Start server
// ============================================================

server.listen(PORT, () => {
  log(`${SERVICE_NAME} listening on :${PORT}`);
});