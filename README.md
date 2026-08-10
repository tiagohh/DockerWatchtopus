# DockerWatchtopus

DockerWatchtopus is a small, Dockerized telemetry stack to collect per-viewer playback metrics for live streams and help diagnose client-side playback issues (stalls/freezes) that affect only some viewers. It is intentionally minimal and designed to be run locally or on a private server behind a reverse proxy.

Repository contents

- docker-compose.yml — Compose stack: InfluxDB (time-series DB), Grafana, metrics API (Node/Express), static file server (nginx) serving client scripts.
- api/
  - Dockerfile
  - package.json
  - index.js — Express collector that ingests client telemetry and writes to InfluxDB.
- static/
  - client-youtube.js — instrumentation for embedded YouTube IFrame (heuristic stall detection).
  - client-html5.js — instrumentation for native `<video>` playback (uses getVideoPlaybackQuality when available).
- grafana/dashboard.json — sample Grafana dashboard you can import.
- LICENSE — MIT

Overview

This project focuses on collecting client-side telemetry from viewers you control (embedded player) or who consent to install an instrumented page/extension. It does not scrape youtube.com or bypass YouTube policies — if you need to collect telemetry from viewers on youtube.com you must obtain informed consent and/or use a browser extension; that is outside the scope of this repository.

Why collect client telemetry?
- Server-side or provider APIs rarely expose per-client playback internals ("Stats for nerds" is not an official public API).
- When "some users see a freeze" you need per-client signals (stall events, device/browser, network type, dropped frames) to identify common denominators.

Quick start (local)

Prerequisites
- Docker (v20+) and Docker Compose v2+ installed
- Ports used by the stack: 8086 (InfluxDB), 3000 (Grafana), 4000 (API), 8080 (static) — ensure they are free or edit docker-compose.yml accordingly.

1) Clone the repo

  git clone https://github.com/tiagohh/DockerWatchtopus.git
  cd DockerWatchtopus

2) Build and start

  docker compose up --build

3) InfluxDB interactive setup (first run)

Open http://localhost:8086 in your browser and complete the interactive setup. Steps to follow in the UI:
- Organization name: choose e.g. "example-org" (this repo uses example-org as the default env value)
- Bucket name: choose e.g. "stream_metrics" (or use a different name; if different, update INFLUX_BUCKET in docker-compose.yml and restart the api container)
- Create an initial user (optional) and password for UI access
- IMPORTANT: Create a Write Token and copy it to a safe place — you will need it for the API service.

4) Configure the API write token

Two options:
A) Quick (recommended for local):
- Edit docker-compose.yml and replace the placeholder value INFLUX_TOKEN=changeme-token under the `api` service with the token you copied from Influx UI.
- Recreate the API container:

  docker compose up -d --build api

B) Alternative: pass token as an environment variable when running the container (example on Linux/macOS):

  INFLUX_TOKEN="<paste-token>" docker compose up -d --build api

Note: the compose file also contains commented INFLUXDB_INIT_* env examples (uncomment to pre-seed Influx non-interactively). These are intentionally commented for security — do not commit real credentials.

5) Verify the API is running

Health check:

  curl http://localhost:4000/health

Send a test metric:

  curl -X POST http://localhost:4000/metrics -H "Content-Type: application/json" \
    -d '{"videoId":"demo","clientId":"test-client","event":"tick","currentTime":1,"ts":"2026-08-10T00:00:00Z"}'

You should get a JSON {"ok":true} response and see points in Influx (try a query in the Influx UI or import dashboard in Grafana).

Grafana setup

1) Open Grafana: http://localhost:3000
  - Default login is admin / admin (change it after first login). See security notes below.

2) Add an InfluxDB datasource
  - Configuration -> Data Sources -> Add data source -> InfluxDB
  - URL: http://influxdb:8086
  - Auth: Token — paste the same Write Token created earlier (or a token with read access). For organization, use the same org name you created (example-org)
  - Default bucket: stream_metrics
  - Save & Test

3) Import the sample dashboard
  - Dashboard -> Manage -> Import -> Upload grafana/dashboard.json (file in this repo)
  - When prompted, select the InfluxDB datasource you just created.

Sample Flux queries used by the dashboard

- Count of stall events (last 1h):

  from(bucket: "stream_metrics")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "playback" and r.event == "stall" and r._field == "stallDurationMs")
    |> count()

- Average stall duration (ms) over time (last 6h):

  from(bucket: "stream_metrics")
    |> range(start: -6h)
    |> filter(fn: (r) => r._measurement == "playback" and r._field == "stallDurationMs")
    |> mean()
    |> yield(name: "mean")

- Top user agents by stall count (last 24h):

  from(bucket: "stream_metrics")
    |> range(start: -24h)
    |> filter(fn: (r) => r._measurement == "playback" and r.event == "stall")
    |> group(columns: ["ua"])
    |> count()
    |> sort(columns: ["_value"], desc: true)
    |> limit(n: 20)

Integrating the client scripts

You can either serve the client JavaScript from the `static` nginx container (http://localhost:8080/client-youtube.js) or bundle it into your pages.

YouTube IFrame usage example

1) Add YouTube IFrame API to your page and create a player per YouTube docs.
2) Include or load the client-youtube.js script and call startMonitoring(player, { endpoint: 'http://your-server:4000/metrics', videoId: 'VIDEO_ID' })

Example snippet:

<script src="https://www.youtube.com/iframe_api"></script>
<script src="http://localhost:8080/client-youtube.js"></script>
<script>
  function onYouTubeIframeAPIReady() {
    const player = new YT.Player('player', { videoId: 'VIDEO_ID' });
    // small delay until player is ready
    setTimeout(() => window.DockerWatchtopus.startMonitoring(player, { endpoint: 'http://localhost:4000/metrics' }), 1000);
  }
</script>

Native HTML5 <video> usage example

<script src="http://localhost:8080/client-html5.js"></script>
<script>
  const v = document.querySelector('video');
  window.DockerWatchtopus.monitorVideo(v, { endpoint: 'http://localhost:4000/metrics', videoId: 'my-stream-1' });
</script>

Auth and hardening (recommended)

- Replace the placeholder INFLUX_TOKEN value in docker-compose.yml with a real token immediately after creating it in Influx UI.
- Consider setting API_TOKEN environment variable for the api container (API_TOKEN) so clients must present a header `x-api-token: <token>` or query param `?api_token=` to post metrics. The collector supports this if API_TOKEN is set.
- Restrict access by running the stack behind a reverse proxy (nginx/Traefik) with TLS and authentication.
- Do not expose InfluxDB or Grafana to the public internet without proper authentication and network restrictions.

Privacy, consent, and data retention

- Obtain clear, informed consent from users before collecting telemetry. Display a short consent dialog or include the monitoring in the site’s privacy policy.

Suggested consent text (short):
"To help us diagnose streaming problems and improve playback quality, this site collects anonymous playback telemetry (buffering events, device/browser type, and anonymized performance counters). No personal information is collected. You may opt out at any time."

- Avoid sending PII. Client IDs should be opaque random identifiers (example code uses a random 8-character id). If you need to correlate to accounts, do this on the server and store only a hashed identifier in the timeseries DB.
- Retention: set a retention policy in Influx or periodically purge older data. Do not keep telemetry longer than necessary.

Development notes

- To run only the API locally (without Docker): install dependencies in ./api and run node index.js after setting INFLUX_* env variables.

  cd api
  npm ci
  INFLUX_URL="http://localhost:8086" INFLUX_TOKEN="<token>" INFLUX_ORG="example-org" INFLUX_BUCKET="stream_metrics" node index.js

Troubleshooting

- API returns 401: set API_TOKEN in the api container or remove the client header.
- API fails to write to Influx: verify INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET; check Influx logs for auth errors.
- No data in Grafana panels: ensure datasource is configured with the correct token and bucket; ensure time range isn't excluding recent points (set to Last 1 hour).

Contributing

Contributions welcome. Open issues for bugs or feature requests. Major features:
- Add authentication for Grafana/Influx via secrets manager
- Add examples for Prometheus exporters or additional metrics
- Build a browser extension to safely collect metrics from youtube.com (requires legal review and explicit user consent)

License

This project is MIT licensed. See the LICENSE file.
