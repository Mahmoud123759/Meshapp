'use strict';

const Pyroscope = require('@pyroscope/nodejs');

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
const { Resource } = require('@opentelemetry/resources');

const {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_SERVICE_NAMESPACE,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} = require('@opentelemetry/semantic-conventions');

const SERVICE_NAME =
  process.env.SERVICE_NAME || 'meshapp-unknown';

const OTEL_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
  'http://alloy.monitoring.svc.cluster.local:4317';

/*
 * ============================================================
 * OpenTelemetry
 * ============================================================
 */

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
    [SEMRESATTRS_SERVICE_NAMESPACE]: 'meshapp',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: 'meshapp',
  }),

  traceExporter: new OTLPTraceExporter({
    url: OTEL_ENDPOINT,
  }),

  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => {
        return req.url === '/metrics' || req.url === '/health';
      },
    }),

    new PgInstrumentation(),
  ],
});

sdk.start();

/*
 * ============================================================
 * Pyroscope
 * ============================================================
 *
 * Node.js SDK profiles:
 *
 * CPU:
 *   process_cpu:cpu:nanoseconds:cpu:nanoseconds
 *
 * Wall:
 *   wall:wall:nanoseconds:wall:nanoseconds
 *
 * Heap:
 *   Node.js Heap profile
 *
 * CPU collection is explicitly enabled below.
 * ============================================================
 */

const PYROSCOPE_SERVER =
  process.env.PYROSCOPE_SERVER ||
  'http://pyroscope.monitoring.svc.cluster.local:4040';

Pyroscope.init({
  serverAddress: PYROSCOPE_SERVER,

  /*
   * This becomes the Pyroscope service_name label.
   *
   * Example:
   *   meshapp-storage-a
   *   meshapp-storage-b
   *   meshapp-processor
   *   meshapp-aggregator
   *   meshapp-ingress-gw
   */
  appName: SERVICE_NAME,

  tags: {
    namespace: 'meshapp',
    env: 'meshapp',
  },

  /*
   * Explicitly collect CPU time.
   *
   * This is important for the CPU profile.
   */
  wall: {
    collectCpuTime: true,
  },
});

Pyroscope.start();

/*
 * ============================================================
 * Startup log
 * ============================================================
 */

console.log(
  JSON.stringify({
    time: new Date().toISOString(),
    level: 'info',
    msg: 'Observability SDKs started',
    service: SERVICE_NAME,
    otel_endpoint: OTEL_ENDPOINT,
    pyroscope_server: PYROSCOPE_SERVER,
    pyroscope_cpu: true,
  })
);

/*
 * ============================================================
 * Graceful shutdown
 * ============================================================
 */

process.on('SIGTERM', async () => {
  try {
    await sdk.shutdown();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'OpenTelemetry shutdown failed',
        error: err.message,
      })
    );
  } finally {
    process.exit(0);
  }
});