// Explicit local diagnostics only (?diagnostics=1). Synchronous readback is confined
// to this benchmark: normal animation never blocks on the GPU or allocates sample logs.
export function installDiagnostics({ renderer, loop, renderFrame, stats }) {
  let busy = false;
  window.sceneBenchmark = async ({ frames = 120, warmup = 30, simulationFps = 60 } = {}) => {
    if (busy) throw new Error('A benchmark is already running.');
    if (![frames, warmup, simulationFps].every(Number.isFinite) ||
        frames < 1 || frames > 3600 || warmup < 0 || warmup > 600 ||
        simulationFps < 10 || simulationFps > 120) throw new Error('Invalid benchmark budget.');
    if (document.hidden) throw new Error('Keep the benchmark tab visible.');
    busy = true;
    const wasPaused = loop.state.paused;
    loop.setPaused(true);
    const gl = renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const durations = [];
    const probe = new Uint8Array(4);
    const synchronize = () => {
      // A returned pixel, unlike timing the asynchronous render() calls, guarantees
      // the submitted work has completed even with a browser GPU command process.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
        throw new Error('GPU readback failed; benchmark results discarded.');
    };
    let calls = 0, triangles = 0;
    try {
      // Let any pending one-off resize render settle before the measured run.
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (let i = 0; i < Math.ceil(warmup) + Math.ceil(frames); i++) {
        if (document.hidden || gl.isContextLost()) throw new Error('Benchmark interrupted; results discarded.');
        // Yield between frames so the page remains responsive. This wait is not timed.
        await new Promise((resolve) => setTimeout(resolve, 0));
        synchronize();
        const start = performance.now();
        renderFrame(1 / simulationFps, start);
        synchronize();
        const duration = performance.now() - start;
        if (i >= Math.ceil(warmup)) {
          durations.push(duration);
          calls += renderer.info.render.calls;
          triangles += renderer.info.render.triangles;
        }
      }
      const sorted = [...durations].sort((a, b) => a - b);
      const quantile = (p) => {
        const at = (sorted.length - 1) * p;
        const lo = Math.floor(at), hi = Math.ceil(at);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
      };
      const meanMs = durations.reduce((a, b) => a + b, 0) / durations.length;
      const result = {
        method: 'Synchronous 1-pixel readback: CPU + GPU render service time, not presentation FPS or battery use',
        gpu, userAgent: navigator.userAgent, simulationFps,
        frames: durations.length, warmup: Math.ceil(warmup),
        meanMs, medianMs: quantile(0.5), p95Ms: quantile(0.95),
        meanDrawCalls: calls / durations.length, meanTriangles: triangles / durations.length,
        settings: stats(), durations,
      };
      console.info('Scene benchmark', result);
      return result;
    } finally {
      busy = false;
      loop.setPaused(wasPaused);
    }
  };
}
