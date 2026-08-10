const express = require('express');
const bodyParser = require('body-parser');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

const INFLUX_URL = process.env.INFLUX_URL || 'http://localhost:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || 'changeme-token';
const INFLUX_ORG = process.env.INFLUX_ORG || 'example-org';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'stream_metrics';
const API_TOKEN = process.env.API_TOKEN || null; // optional simple auth for client->collector

const influxDB = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influxDB.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ms');

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '200kb' }));

// Basic rate limiting for safety
const limiter = rateLimit({
  windowMs: 10 * 1000, // 10s
  max: 60, // per IP
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Optional authentication middleware
if (API_TOKEN) {
  app.use((req, res, next) => {
    const token = req.headers['x-api-token'] || req.query.api_token;
    if (!token || token !== API_TOKEN) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
}

app.get('/health', (req, res) => res.json({ ok: true }));

// Accept metrics
// expects JSON: { videoId, clientId, ts, event: 'tick'|'stall'|'error', currentTime, buffered, playbackRate, droppedFrames, ua, effectiveType }
app.post('/metrics', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.videoId || !payload.clientId) {
      return res.status(400).json({ error: 'videoId and clientId required' });
    }

    const p = new Point('playback')
      .tag('videoId', String(payload.videoId))
      .tag('clientId', String(payload.clientId))
      .tag('event', String(payload.event || 'tick'));

    if (payload.currentTime != null) p.floatField('currentTime', Number(payload.currentTime));
    if (payload.buffered != null) p.floatField('buffered', Number(payload.buffered));
    if (payload.playbackRate != null) p.floatField('playbackRate', Number(payload.playbackRate));
    if (payload.droppedFrames != null) p.intField('droppedFrames', Number(payload.droppedFrames));
    if (payload.totalVideoFrames != null) p.intField('totalVideoFrames', Number(payload.totalVideoFrames));
    if (payload.stallDurationMs != null) p.intField('stallDurationMs', Number(payload.stallDurationMs));
    if (payload.rttMs != null) p.intField('rttMs', Number(payload.rttMs));
    if (payload.ua) p.stringField('ua', String(payload.ua));
    if (payload.effectiveType) p.tag('effectiveType', String(payload.effectiveType));
    if (payload.errorCode) p.intField('errorCode', Number(payload.errorCode));

    p.timestamp(payload.ts ? new Date(payload.ts) : new Date());

    writeApi.writePoint(p);

    // Do not flush on every request for performance; Influx client flushes periodically.
    res.json({ ok: true });
  } catch (err) {
    console.error('metrics error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Simple endpoint to test API token requirement
app.get('/ping', (req, res) => res.json({ pong: true, inboundAuth: API_TOKEN ? 'required' : 'not-required' }));

// Graceful shutdown: flush pending points
async function shutdown() {
  console.log('Shutting down, flushing Influx writes...');
  try {
    await writeApi.close();
    console.log('Influx writeApi closed.');
    process.exit(0);
  } catch (e) {
    console.error('Error closing writeApi', e);
    process.exit(1);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`metrics API listening on ${PORT}`));
