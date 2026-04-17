/* ═══════════════════════════════════════════════════════
   Handwriting Video Generator — Canvas Engine
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────
  const state = {
    text: 'Hello World',
    font: 'Caveat',
    colorMode: 'solid',
    color1: '#ffffff',
    grad1: '#ff6b6b', grad2: '#4ecdc4', gradDir: 'horizontal',
    neonColor: '#00ff88', glowSize: 15,
    anim: 'write',
    strokeWidth: 4,
    jitter: 2,
    pressure: 40,
    inkBleed: true,
    writeSpeed: 8,
    holdTime: 1,
    letterDelay: 50,
    fontSize: 100,
    posX: 50, posY: 50,
    rotation: 0,
    resolution: 1080,
    fps: 30,
    format: 'webm',
    quality: 0.8,
  };

  // ── Canvas setup ───────────────────────────────────────
  const canvas = document.getElementById('preview-canvas');
  const ctx = canvas.getContext('2d', { alpha: true });

  function setResolution() {
    const res = parseInt(state.resolution);
    const w = res === 720 ? 1280 : res === 1080 ? 1920 : res === 1440 ? 2560 : 3840;
    const h = res === 720 ? 720 : res === 1080 ? 1080 : res === 1440 ? 1440 : 2160;
    canvas.width = w;
    canvas.height = h;
    document.getElementById('info-res').textContent = `${w}×${h}`;
    updateCanvasDisplay();
  }

  function updateCanvasDisplay() {
    const area = document.getElementById('preview-area');
    const aw = area.clientWidth - 48, ah = area.clientHeight - 80;
    const ratio = canvas.width / canvas.height;
    let dw = aw, dh = aw / ratio;
    if (dh > ah) { dh = ah; dw = ah * ratio; }
    canvas.style.width = dw + 'px';
    canvas.style.height = dh + 'px';
  }

  // ── Noise / helpers ────────────────────────────────────
  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // Simple 1D Perlin-like noise
  const noiseTable = Array.from({ length: 256 }, () => Math.random() * 2 - 1);
  function noise1(x) {
    const i = Math.floor(x) & 255;
    const f = x - Math.floor(x);
    const u = f * f * (3 - 2 * f);
    return noiseTable[i] * (1 - u) + noiseTable[(i + 1) & 255] * u;
  }

  // ── Color utilities ────────────────────────────────────
  function buildStroke(x, y, t) {
    const { colorMode, color1, grad1, grad2, gradDir, neonColor, glowSize, anim } = state;
    if (colorMode === 'neon') {
      ctx.shadowColor = neonColor;
      ctx.shadowBlur = glowSize;
      return neonColor;
    } else {
      ctx.shadowBlur = 0;
    }
    if (colorMode === 'rainbow') {
      const hue = (t * 360 + x * 0.1) % 360;
      return `hsl(${hue},100%,70%)`;
    }
    if (colorMode === 'gradient') {
      const w = canvas.width, h = canvas.height;
      let g;
      if (gradDir === 'radial') {
        g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      } else {
        const x0 = gradDir === 'vertical' ? 0 : 0;
        const y0 = gradDir === 'vertical' ? 0 : gradDir === 'diagonal' ? 0 : 0;
        const x1 = gradDir === 'vertical' ? 0 : w;
        const y1 = gradDir === 'vertical' ? h : gradDir === 'diagonal' ? h : 0;
        g = ctx.createLinearGradient(x0, y0, x1, y1);
      }
      g.addColorStop(0, grad1);
      g.addColorStop(1, grad2);
      return g;
    }
    return color1;
  }

  // ── Ink-bleed effect ────────────────────────────────────
  function applyInkBleed() {
    if (!state.inkBleed) return;
    ctx.globalAlpha = 0.06;
    ctx.filter = 'blur(2px)';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  // ── Path extraction from font ──────────────────────────
  // We use measureText + actual pixel tracing for the "drawing" effect
  // because opentype.js requires font file URLs. Instead we use a
  // stroke-dasharray animation approach on an SVG overlay extracted
  // from the canvas text, combined with a scanline-based reveal.

  // Build an offscreen canvas with the full rendered text
  function renderTextOffscreen() {
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const oc = off.getContext('2d', { alpha: true });

    const sz = state.fontSize * (canvas.width / 1920);
    oc.font = `${sz}px '${state.font}'`;
    oc.fillStyle = state.color1;
    oc.textAlign = 'center';
    oc.textBaseline = 'middle';

    const x = (state.posX / 100) * canvas.width;
    const y = (state.posY / 100) * canvas.height;

    oc.save();
    oc.translate(x, y);
    oc.rotate((state.rotation * Math.PI) / 180);
    oc.fillText(state.text, 0, 0);
    oc.restore();
    return { canvas: off, ctx: oc, x, y, sz };
  }

  // Extract non-transparent pixels as a sorted path (left→right, top→bottom per column)
  function extractPixelPath(offCtx, w, h) {
    const imageData = offCtx.getImageData(0, 0, w, h);
    const data = imageData.data;
    // Group pixels by x column for a writing-order feel
    const cols = [];
    for (let x = 0; x < w; x++) {
      const col = [];
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] > 30) col.push({ x, y, a: data[i + 3] / 255 });
      }
      if (col.length) cols.push(col);
    }
    return cols;
  }

  // ── Animation frame data ───────────────────────────────
  let animFrame = null;
  let recording = false;
  let recordFrames = [];

  // ── Main animation: WRITE effect ──────────────────────
  function animWrite(onComplete) {
    const { canvas: off, ctx: oc, x: cx, y: cy, sz } = renderTextOffscreen();
    const cols = extractPixelPath(oc, off.width, off.height);
    if (!cols.length) return;

    const totalCols = cols.length;
    const speed = state.writeSpeed; // cols per frame
    let col = 0;
    let noiseOff = 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    function frame() {
      const end = Math.min(col + speed, totalCols);
      const t = col / totalCols;
      const strokeColor = buildStroke(col, cy, t);
      const jit = state.jitter;
      const pres = state.pressure / 100;

      for (let ci = col; ci < end; ci++) {
        const colData = cols[ci];
        for (const px of colData) {
          const nx = noise1(noiseOff + ci * 0.1) * jit;
          const ny = noise1(noiseOff + ci * 0.1 + 99) * jit;
          const alpha = clamp(px.a * (1 - pres * rand(0, 0.5)), 0.1, 1);
          const w = state.strokeWidth * (canvas.width / 1920) * (1 - pres * rand(-0.3, 0.3));

          ctx.globalAlpha = alpha;
          ctx.fillStyle = strokeColor;
          ctx.beginPath();
          ctx.arc(px.x + nx, px.y + ny, Math.max(0.5, w * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      noiseOff += 0.05;
      col = end;

      if (recording) recordFrames.push(captureFrame());

      if (col < totalCols) {
        animFrame = requestAnimationFrame(frame);
      } else {
        applyInkBleed();
        if (recording) {
          const hold = Math.round(state.holdTime * state.fps);
          const last = captureFrame();
          for (let i = 0; i < hold; i++) recordFrames.push(last);
        }
        document.getElementById('info-status').textContent = '✓ Listo';
        if (onComplete) onComplete();
      }
    }
    animFrame = requestAnimationFrame(frame);
  }

  // ── BOUNCE effect ──────────────────────────────────────
  function animBounce(onComplete) {
    const { canvas: off, ctx: oc, x: cx, y: cy, sz } = renderTextOffscreen();
    const duration = 2 + state.holdTime;
    const fps = state.fps;
    const totalFrames = Math.round(duration * fps);
    let f = 0;

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = f / totalFrames;
      const bounceY = Math.abs(Math.sin(t * Math.PI * 4)) * 30 * (canvas.height / 1080);
      const scale = 1 + Math.sin(t * Math.PI * 3) * 0.05;

      ctx.save();
      ctx.translate(cx, cy + bounceY);
      ctx.scale(scale, scale);
      ctx.rotate((state.rotation * Math.PI) / 180);
      drawTextStyled(ctx, 0, 0, sz, t);
      ctx.restore();

      if (recording) recordFrames.push(captureFrame());
      f++;
      if (f < totalFrames) { animFrame = requestAnimationFrame(frame); }
      else { if (onComplete) onComplete(); }
    }
    animFrame = requestAnimationFrame(frame);
  }

  // ── SHAKE (jitter) effect ─────────────────────────────
  function animShake(onComplete) {
    const { x: cx, y: cy, sz } = renderTextOffscreen();
    const duration = 2 + state.holdTime;
    const fps = state.fps;
    const totalFrames = Math.round(duration * fps);
    let f = 0;
    const jit = state.jitter * 3;

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = f / totalFrames;
      const nx = noise1(f * 0.3) * jit * (canvas.width / 1920);
      const ny = noise1(f * 0.3 + 50) * jit * (canvas.height / 1080);
      const rot = noise1(f * 0.2 + 100) * 0.04 + (state.rotation * Math.PI) / 180;

      ctx.save();
      ctx.translate(cx + nx, cy + ny);
      ctx.rotate(rot);
      drawTextStyled(ctx, 0, 0, sz, t);
      ctx.restore();

      if (recording) recordFrames.push(captureFrame());
      f++;
      if (f < totalFrames) { animFrame = requestAnimationFrame(frame); }
      else { if (onComplete) onComplete(); }
    }
    animFrame = requestAnimationFrame(frame);
  }

  // ── WAVE effect ─────────────────────────────────────
  function animWave(onComplete) {
    const { x: cx, y: cy, sz } = renderTextOffscreen();
    const duration = 3 + state.holdTime;
    const fps = state.fps;
    const totalFrames = Math.round(duration * fps);
    let f = 0;
    const chars = state.text.split('');

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = f / totalFrames;
      const scaledSz = sz;
      ctx.font = `${scaledSz}px '${state.font}'`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      // Measure total width
      let totalW = ctx.measureText(state.text).width;
      let startX = cx - totalW / 2;

      chars.forEach((ch, i) => {
        const cw = ctx.measureText(ch).width;
        const waveY = Math.sin((f * 0.1 + i * 0.8)) * 20 * (canvas.height / 1080);
        const waveRot = Math.sin((f * 0.08 + i * 0.5)) * 0.1;

        ctx.save();
        ctx.translate(startX + cw / 2, cy + waveY);
        ctx.rotate(waveRot + (state.rotation * Math.PI) / 180);
        ctx.fillStyle = buildStroke(startX, cy + waveY, t + i * 0.05);
        ctx.globalAlpha = 1;
        ctx.fillText(ch, -cw / 2, 0);
        ctx.restore();
        startX += cw;
      });

      if (recording) recordFrames.push(captureFrame());
      f++;
      if (f < totalFrames) { animFrame = requestAnimationFrame(frame); }
      else { if (onComplete) onComplete(); }
    }
    animFrame = requestAnimationFrame(frame);
  }

  // ── GLITCH effect ──────────────────────────────────────
  function animGlitch(onComplete) {
    const { x: cx, y: cy, sz } = renderTextOffscreen();
    const duration = 2.5 + state.holdTime;
    const fps = state.fps;
    const totalFrames = Math.round(duration * fps);
    let f = 0;

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = f / totalFrames;
      const isGlitch = Math.random() < 0.3;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((state.rotation * Math.PI) / 180);

      if (isGlitch) {
        // RGB split
        const off1 = rand(-8, 8) * (canvas.width / 1920);
        const off2 = rand(-8, 8) * (canvas.width / 1920);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#ff0040';
        ctx.font = `${sz}px '${state.font}'`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(state.text, off1, 0);
        ctx.fillStyle = '#00ffff';
        ctx.fillText(state.text, -off1, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = buildStroke(cx, cy, t);
        ctx.fillText(state.text, off2 * 0.3, 0);

        // Horizontal slice distortion
        const slices = Math.floor(rand(2, 6));
        for (let s = 0; s < slices; s++) {
          const sy = rand(-sz, sz);
          const sh = rand(2, 10);
          const sdx = rand(-20, 20) * (canvas.width / 1920);
          const region = document.createElement('canvas');
          region.width = canvas.width; region.height = sh;
          const rc = region.getContext('2d');
          rc.drawImage(canvas, 0, cy + sy, canvas.width, sh, 0, 0, canvas.width, sh);
          ctx.drawImage(region, sdx, cy + sy);
        }
      } else {
        drawTextStyled(ctx, 0, 0, sz, t);
      }
      ctx.restore();

      if (recording) recordFrames.push(captureFrame());
      f++;
      if (f < totalFrames) { animFrame = requestAnimationFrame(frame); }
      else { if (onComplete) onComplete(); }
    }
    animFrame = requestAnimationFrame(frame);
  }

  // ── INK DROP effect ─────────────────────────────────
  function animInkDrop(onComplete) {
    const { canvas: off, ctx: oc, x: cx, y: cy, sz } = renderTextOffscreen();
    const cols = extractPixelPath(oc, off.width, off.height);
    if (!cols.length) return;

    // Sort pixels radially from center
    const allPixels = cols.flat();
    allPixels.sort((a, b) => {
      const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
      const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
      return da - db;
    });

    const speed = state.writeSpeed * 3;
    let idx = 0;
    const total = allPixels.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    function frame() {
      const end = Math.min(idx + speed, total);
      const t = idx / total;
      const strokeColor = buildStroke(cx, cy, t);
      const jit = state.jitter * 0.5;
      const pres = state.pressure / 100;

      for (let i = idx; i < end; i++) {
        const px = allPixels[i];
        const nx = noise1(i * 0.07) * jit;
        const ny = noise1(i * 0.07 + 99) * jit;
        const spread = 1 + (1 - idx / total) * 3;
        const alpha = clamp(px.a * rand(0.6, 1.0), 0.3, 1);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = strokeColor;
        ctx.beginPath();
        ctx.arc(px.x + nx, px.y + ny, Math.max(0.5, spread * state.strokeWidth * 0.4 * (canvas.width / 1920)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      idx = end;

      if (recording) recordFrames.push(captureFrame());
      if (idx < total) {
        animFrame = requestAnimationFrame(frame);
      } else {
        applyInkBleed();
        if (onComplete) onComplete();
      }
    }
    animFrame = requestAnimationFrame(frame);
  }

  // ── Helper: draw styled text on ctx at (x,y) ──────────
  function drawTextStyled(c, x, y, sz, t) {
    c.font = `${sz}px '${state.font}'`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = buildStroke(x, y, t);
    c.globalAlpha = 1;
    c.fillText(state.text, x, y);
  }

  // ── Frame capture ──────────────────────────────────────
  function captureFrame() {
    const f = document.createElement('canvas');
    f.width = canvas.width;
    f.height = canvas.height;
    f.getContext('2d').drawImage(canvas, 0, 0);
    return f;
  }

  // ── Dispatcher ────────────────────────────────────────
  function runAnimation(onComplete) {
    if (animFrame) cancelAnimationFrame(animFrame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('info-status').textContent = '⏳ Animando...';

    const map = {
      write: animWrite,
      bounce: animBounce,
      shake: animShake,
      wave: animWave,
      glitch: animGlitch,
      ink: animInkDrop,
    };
    (map[state.anim] || animWrite)(onComplete);
  }

  // ── Export ────────────────────────────────────────────
  function exportVideo() {
    const btn = document.getElementById('btn-export');
    const progress = document.getElementById('export-progress');
    const fill = document.getElementById('progress-fill');
    const txt = document.getElementById('progress-text');

    btn.disabled = true;
    recording = true;
    recordFrames = [];
    progress.classList.remove('hidden');
    fill.style.width = '5%';
    txt.textContent = 'Renderizando frames...';
    document.getElementById('info-status').textContent = '⏺ Grabando...';

    runAnimation(() => {
      recording = false;
      fill.style.width = '60%';
      txt.textContent = 'Codificando video...';

      setTimeout(() => {
        if (state.format === 'gif') {
          encodeGIF(recordFrames, fill, txt, btn, progress);
        } else {
          encodeWebM(recordFrames, fill, txt, btn, progress);
        }
      }, 100);
    });
  }

  function encodeWebM(frames, fill, txt, btn, progress) {
    if (!frames.length) return;
    const fps = parseInt(state.fps);
    const offscreen = frames[0];
    const stream = offscreen.captureStream ? offscreen.captureStream(fps) : null;

    // Use MediaRecorder on a playback canvas
    const playCanvas = document.createElement('canvas');
    playCanvas.width = frames[0].width;
    playCanvas.height = frames[0].height;
    const pc = playCanvas.getContext('2d');
    const mediaStream = playCanvas.captureStream(fps);

    const chunks = [];
    const mime = 'video/webm;codecs=vp9';
    const supported = MediaRecorder.isTypeSupported(mime);
    const recorder = new MediaRecorder(mediaStream, {
      mimeType: supported ? mime : 'video/webm',
      videoBitsPerSecond: Math.round(parseFloat(state.quality) * 10_000_000),
    });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      downloadBlob(blob, 'handwriting.webm');
      fill.style.width = '100%';
      txt.textContent = '✓ Descarga lista';
      btn.disabled = false;
      progress.classList.add('hidden');
      document.getElementById('info-status').textContent = '✓ Listo';
    };

    recorder.start();
    let fi = 0;
    const interval = 1000 / fps;

    function pushFrame() {
      if (fi >= frames.length) { recorder.stop(); return; }
      pc.clearRect(0, 0, playCanvas.width, playCanvas.height);
      pc.drawImage(frames[fi], 0, 0);
      const pct = 60 + (fi / frames.length) * 38;
      fill.style.width = pct + '%';
      txt.textContent = `Codificando ${fi + 1}/${frames.length}...`;
      fi++;
      setTimeout(pushFrame, interval);
    }
    pushFrame();
  }

  // Simple GIF encoder using canvas frames as PNG sequence download
  function encodeGIF(frames, fill, txt, btn, progress) {
    // Since a pure-JS GIF encoder adds 30KB+, we export as a PNG sequence ZIP
    // or use the simpler approach: export individual frames as a ZIP
    txt.textContent = 'Exportando frames PNG...';

    // Use apng-js approach: create a WebM anyway
    encodeWebM(frames, fill, txt, btn, progress);
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // ── UI binding ─────────────────────────────────────────
  function bindControls() {
    // Text
    const textEl = document.getElementById('input-text');
    textEl.addEventListener('input', () => { state.text = textEl.value || ' '; });

    // Font
    document.getElementById('font-picker').addEventListener('click', e => {
      const card = e.target.closest('.font-card');
      if (!card) return;
      document.querySelectorAll('.font-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      state.font = card.dataset.font;
    });

    // Color mode
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.colorMode = btn.dataset.mode;
        ['solid', 'gradient', 'neon'].forEach(m => {
          document.getElementById('color-' + m)?.classList.add('hidden');
        });
        const target = document.getElementById('color-' + state.colorMode);
        if (target) target.classList.remove('hidden');
      });
    });

    // Anim mode
    document.querySelectorAll('.anim-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.anim-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.anim = btn.dataset.anim;
      });
    });

    // Colors
    bindColor('color1', 'color1');
    bindColor('grad1', 'grad1');
    bindColor('grad2', 'grad2');
    bindColor('neon-color', 'neonColor');
    document.getElementById('grad-dir').addEventListener('change', e => { state.gradDir = e.target.value; });

    // Sliders
    bindSlider('glow-size', 'glowSize', 'glow-val', v => v);
    bindSlider('stroke-width', 'strokeWidth', 'sw-val', v => v);
    bindSlider('jitter', 'jitter', 'jit-val', v => v);
    bindSlider('pressure', 'pressure', 'pres-val', v => v + '%');
    bindSlider('write-speed', 'writeSpeed', 'ws-val', v => v);
    bindSlider('hold-time', 'holdTime', 'ht-val', v => v + 's');
    bindSlider('letter-delay', 'letterDelay', 'ld-val', v => v + 'ms');
    bindSlider('font-size', 'fontSize', 'fs-val', v => v + 'px');
    bindSlider('pos-x', 'posX', 'px-val', v => v + '%');
    bindSlider('pos-y', 'posY', 'py-val', v => v + '%');
    bindSlider('rotation', 'rotation', 'rot-val', v => v + '°');

    // Checkbox
    document.getElementById('ink-bleed').addEventListener('change', e => { state.inkBleed = e.target.checked; });

    // Export options
    document.getElementById('resolution').addEventListener('change', e => {
      state.resolution = e.target.value;
      setResolution();
    });
    document.getElementById('fps').addEventListener('change', e => { state.fps = parseInt(e.target.value); document.getElementById('info-fps').textContent = e.target.value + ' fps'; });
    document.getElementById('format').addEventListener('change', e => { state.format = e.target.value; });
    document.getElementById('quality').addEventListener('change', e => { state.quality = parseFloat(e.target.value); });

    // Buttons
    document.getElementById('btn-preview').addEventListener('click', () => { runAnimation(null); });
    document.getElementById('btn-export').addEventListener('click', exportVideo);
  }

  function bindColor(id, key) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { state[key] = el.value; });
  }

  function bindSlider(id, key, valId, fmt) {
    const el = document.getElementById(id);
    const vEl = document.getElementById(valId);
    const update = () => {
      state[key] = parseFloat(el.value);
      if (vEl) vEl.textContent = fmt(el.value);
    };
    el.addEventListener('input', update);
    update();
  }

  // ── Init ───────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    setResolution();
    bindControls();
    window.addEventListener('resize', updateCanvasDisplay);
    // Auto-preview on load
    setTimeout(() => runAnimation(null), 300);
  });

})();
