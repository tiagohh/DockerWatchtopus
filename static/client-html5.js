// Client instrumentation for native HTML5 <video> elements
// Usage:
// 1) Include this script on pages where you control a <video> element.
// 2) Call monitorVideo(videoEl, { endpoint: 'http://your-collector:4000/metrics', videoId: 'optional-id' })

function monitorVideo(videoEl, opts = {}) {
  const endpoint = opts.endpoint || (window.DW_ENDPOINT || 'http://localhost:4000/metrics');
  const videoId = opts.videoId || videoEl.dataset.videoId || 'unknown';
  const clientId = opts.clientId || (window.DW_CLIENT_ID = window.DW_CLIENT_ID || Math.random().toString(36).slice(2, 10));

  async function send(payload) {
    payload.videoId = videoId;
    payload.clientId = clientId;
    payload.ua = navigator.userAgent;
    payload.effectiveType = (navigator.connection && navigator.connection.effectiveType) || 'unknown';
    payload.ts = payload.ts || new Date().toISOString();
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // don't break playback
      console.warn('DW: failed to send metrics', e);
    }
  }

  let stallStart = null;

  videoEl.addEventListener('stalled', () => {
    stallStart = Date.now();
  });
  videoEl.addEventListener('waiting', () => {
    stallStart = Date.now();
  });
  videoEl.addEventListener('playing', async () => {
    if (stallStart) {
      const dur = Date.now() - stallStart;
      stallStart = null;
      await send({ event: 'stall', stallDurationMs: dur, currentTime: videoEl.currentTime });
    }
  });
  videoEl.addEventListener('error', async () => {
    const err = videoEl.error;
    await send({ event: 'error', errorCode: err && err.code, currentTime: videoEl.currentTime });
  });

  // periodic tick
  const intervalMs = opts.intervalMs || 1000;
  const timer = setInterval(async () => {
    try {
      let droppedFrames = null;
      let totalVideoFrames = null;
      if (typeof videoEl.getVideoPlaybackQuality === 'function') {
        try {
          const q = videoEl.getVideoPlaybackQuality();
          droppedFrames = q.droppedVideoFrames || null;
          totalVideoFrames = q.totalVideoFrames || null;
        } catch (e) { /* ignore */ }
      }

      const bufferedSeconds = (videoEl.buffered.length ? (videoEl.buffered.end(videoEl.buffered.length - 1) - videoEl.currentTime) : 0);

      await send({
        event: 'tick',
        currentTime: videoEl.currentTime,
        buffered: bufferedSeconds,
        playbackRate: videoEl.playbackRate,
        droppedFrames,
        totalVideoFrames
      });
    } catch (e) {
      console.error('DW monitor error', e);
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

window.DockerWatchtopus = window.DockerWatchtopus || {};
window.DockerWatchtopus.monitorVideo = monitorVideo;
