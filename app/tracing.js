'use strict';
const Pyroscope = require('@pyroscope/nodejs');

const { NodeSDK }                 = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter }       = require('@opentelemetry/exporter-trace-otlp-grpc');
const { HttpInstrumentation }     = require('@opentelemetry/instrumentation-http');
const { PgInstrumentation }       = require('@opentelemetry/instrumentation-pg');
const { Resource }                = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME,
        SEMRESATTRS_SERVICE_VERSION,
        SEMRESATTRS_SERVICE_NAMESPACE,
        SEMRESATTRS_DEPLOYMENT_ENVIRONMENT }
                                  = require('@opentelemetry/semantic-conventions');

const SERVICE_NAME = process.env.SERVICE_NAME || 'meshapp-unknown';
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  || 'alloy.monitoring.svc.cluster.local:4317';

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]:              SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]:           '1.0.0',
    [SEMRESATTRS_SERVICE_NAMESPACE]:         'meshapp',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]:    'meshapp',
  }),
  traceExporter: new OTLPTraceExporter({
    url: OTEL_ENDPOINT,
  }),
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) =>
        req.url === '/metrics' || req.url === '/health',
    }),
    new PgInstrumentation(),
  ],
});

sdk.start();

Pyroscope.init({
  serverAddress: process.env.PYROSCOPE_SERVER || 'http://pyroscope.monitoring.svc.cluster.local:4040',
  appName:       SERVICE_NAME,
  tags: {
    namespace: 'meshapp',
    env:       'meshapp'
  }
});
Pyroscope.start();

console.log(JSON.stringify({
  time: new Date().toISOString(),
  level: 'info',
  msg: `OTEL SDK started — traces → ${OTEL_ENDPOINT}`,
  service: SERVICE_NAME,
}));

process.on('SIGTERM', () => sdk.shutdown().finally(() => process.exit(0)));