// Client instrumentation for YouTube IFrame API
// Usage:
// 1) Include the YouTube iframe API per docs: <script src="https://www.youtube.com/iframe_api"></script>
// 2) Create a YT.Player instance and call startMonitoring(player, { endpoint, videoId })

function startMonitoring(ytPlayer, opts = {}) {
  const endpoint = opts.endpoint || (window.DW_ENDPOINT || 'http://localhost:4000/metrics');
  const videoId = opts.videoId || (ytPlayer && ytPlayer.getVideoData && ytPlayer.getVideoData().video_id) || 'unknown';
  const clientId = opts.clientId || (window.DW_CLIENT_ID = window.DW_CLIENT_ID || Math.random().toString(36).slice(2, 10));
  let lastTime = null;
  let stallStart = null;

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
      // network issues should not break playback
      console.warn('DW: failed to send metrics', e);
    }
  }

  // Poller: every second record a tick and detect stalls heuristically
  const interval = opts.intervalMs || 1000;
  const timer = setInterval(async () => {
    try {
      const state = (typeof ytPlayer.getPlayerState === 'function') ? ytPlayer.getPlayerState() : null;
      const nowMs = Date.now();
      const currentTime = (typeof ytPlayer.getCurrentTime === 'function') ? ytPlayer.getCurrentTime() : null;

      // detect stall: player says PLAYING but currentTime not advancing
      if (state === YT.PlayerState.PLAYING && currentTime != null) {
        if (lastTime != null && Math.abs(currentTime - lastTime) < 0.05) {
          // potential stall
          if (!stallStart) stallStart = nowMs;
        } else {
          if (stallStart) {
            const duration = nowMs - stallStart;
            await send({ event: 'stall', stallDurationMs: duration, currentTime });
            stallStart = null;
          }
        }
      } else {
        if (stallStart) {
          const duration = nowMs - stallStart;
          await send({ event: 'stall', stallDurationMs: duration, currentTime });
          stallStart = null;
        }
      }

      // periodic tick
      await send({ event: 'tick', currentTime, playbackRate: (ytPlayer.getPlaybackRate && ytPlayer.getPlaybackRate()) || null });
      lastTime = currentTime;
    } catch (err) {
      console.error('DW monitor error', err);
    }
  }, interval);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

// Expose for easy use in pages
window.DockerWatchtopus = window.DockerWatchtopus || {};
window.DockerWatchtopus.startMonitoring = startMonitoring;
