const els = {
  flowState: document.getElementById("flowState"),
  shutterWrap: document.getElementById("shutterWrap"),
  shutterBtn: document.getElementById("shutterBtn"),
  addTextBtn: document.getElementById("addTextBtn"),
  doneBtn: document.getElementById("doneBtn"),
  stage: document.getElementById("stage"),
  camera: document.getElementById("camera"),
  status: document.getElementById("status"),
  envHint: document.getElementById("envHint"),
  effectOptions: document.getElementById("effectOptions"),
  textStyleOptions: document.getElementById("textStyleOptions"),
  resultVideo: document.getElementById("resultVideo"),
  resultImage: document.getElementById("resultImage"),
  downloadImage: document.getElementById("downloadImage"),
  downloadVideo: document.getElementById("downloadVideo"),
};

const ua = navigator.userAgent;
const lowUA = ua.toLowerCase();
const secureLike =
  window.isSecureContext ||
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1";

const stickerPhrases = ["哇哦", "冲呀", "太可爱啦", "耶", "嘻嘻", "我最棒", "开心到飞起", "biu biu"];
const pixelLevels = [2, 3, 4, 5];
const textStyles = ["classic", "neon", "fire", "candy", "shake"];
const fxStyles = ["none", "spark", "heart", "glitch", "confetti", "speed"];
const flowSteps = ["capture", "recording", "edit", "saved"];
const isIpadChrome = (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) && /crios/.test(lowUA);
const flowStepEls = new Map(
  Array.from(els.flowState?.querySelectorAll("[data-step]") || []).map((node) => [node.getAttribute("data-step"), node])
);

const state = {
  facingMode: "user",
  stream: null,
  sourceMode: "live",
  sourceImage: null,
  sourceVideo: null,
  sourceVideoUrl: null,
  sourceVideoDuration: 0,
  chunks: [],
  overlays: [],
  particles: [],
  recording: false,
  recorder: null,
  autoSaveAfterStop: false,
  resetAfterSave: false,
  recordStartTs: 0,
  recordMaxMs: 10000,
  recordProgressRaf: 0,
  renderId: 0,
  lastRenderTs: 0,
  overlaySeq: 1,
  effectId: "none",
  textStyleId: "classic",
  pixelIndex: 1,
  mediaUrl: null,
  imageUrl: null,
  pending: null,
  postEditDirty: false,
  uiMode: "capture",
  flowStep: "capture",
  recordingLocked: false,
  saving: false,
  layoutFreezeUntil: 0,
  micStream: null,
  micRequested: false,
  iPad: /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  isWeChat: /micromessenger/.test(lowUA),
  isChromeIOS: /crios/.test(lowUA),
  lowPowerMode: isIpadChrome,
  supportLiveCamera: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  supportRecorder: Boolean(window.MediaRecorder),
  supportCaptureStream:
    typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function",
  iPadLandscape: false,
  press: {
    active: false,
    pointerId: null,
    timer: 0,
    longTriggered: false,
  },
  drag: {
    active: false,
    overlayId: null,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
  },
};

state.performance = state.lowPowerMode
  ? {
      targetFps: 20,
      maxParticles: 150,
      burstCount: 8,
      sparkSpawnMax: 1,
      confettiSpawnMax: 1,
      glitchLines: 4,
      speedLines: 8,
      scanlineStep: 9,
      resizeDebounceMs: 180,
      exportCaptureFps: 16,
      exportBitrate: 1150000,
      composeBitrate: 1050000,
      maxStageWidthPortrait: 560,
      maxStageWidthLandscape: 660,
      imageBlobType: "image/jpeg",
      imageBlobQuality: 0.88,
    }
  : {
      targetFps: 30,
      maxParticles: 640,
      burstCount: 24,
      sparkSpawnMax: 3,
      confettiSpawnMax: 3,
      glitchLines: 10,
      speedLines: 34,
      scanlineStep: 4,
      resizeDebounceMs: 80,
      exportCaptureFps: 30,
      exportBitrate: 2500000,
      composeBitrate: 2200000,
      maxStageWidthPortrait: 760,
      maxStageWidthLandscape: 760,
      imageBlobType: "image/png",
      imageBlobQuality: 0.95,
    };

if (state.iPad) {
  state.pixelIndex = 0;
}

const ctx = els.stage.getContext("2d", { alpha: false, desynchronized: true });
const tinyCanvas = document.createElement("canvas");
const tinyCtx = tinyCanvas.getContext("2d", { alpha: false });

function vibrateTap() {
  if (navigator.vibrate) navigator.vibrate(10);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function setStatus(text, mode = "ok") {
  els.status.textContent = text;
  els.status.style.color = mode === "error" ? "#c1382c" : "#2b4968";
}

function setUiMode(mode, flowStep = mode) {
  state.uiMode = mode;
  state.flowStep = flowSteps.includes(flowStep) ? flowStep : "capture";
  document.body.dataset.uiMode = state.uiMode;

  const activeIndex = flowSteps.indexOf(state.flowStep);
  flowSteps.forEach((step, index) => {
    const node = flowStepEls.get(step);
    if (!node) return;
    node.classList.toggle("active", index === activeIndex);
    node.classList.toggle("done", index < activeIndex);
  });
}

function waitMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setSavingBusy(on) {
  state.saving = on;
  if (on) {
    state.layoutFreezeUntil = performance.now() + 700;
  }
  [els.shutterBtn, els.addTextBtn, els.doneBtn].forEach((button) => {
    if (button) {
      button.disabled = on;
    }
  });
}

async function finalizeSaveAndReset(saved) {
  if (!saved) return false;
  setUiMode("saved", "saved");
  await waitMs(260);
  await startNewCreation();
  return true;
}

function setShutterProgress(value0to1) {
  const pct = Math.max(0, Math.min(1, value0to1));
  els.shutterWrap.style.setProperty("--progress", `${pct * 100}%`);
}

let fitStageTimer = 0;

function fitStage() {
  updateLayoutMode();
  const parent = els.stage.parentElement;
  const isLandscape = state.iPadLandscape;
  const maxHeightByViewport = Math.floor(window.innerHeight * (isLandscape ? 0.68 : 0.72));
  const maxWidthByHeight = Math.floor((maxHeightByViewport * 3) / 4);
  const width = Math.max(
    320,
    Math.min(
      parent.clientWidth - 20,
      state.iPad
        ? (isLandscape
            ? state.performance.maxStageWidthLandscape
            : state.performance.maxStageWidthPortrait)
        : 760,
      maxWidthByHeight
    )
  );
  const evenWidth = width % 2 === 0 ? width : width - 1;
  const height = Math.floor((evenWidth * 4) / 3);
  els.stage.width = evenWidth;
  els.stage.height = height;
}

function scheduleFitStage() {
  if (fitStageTimer) {
    window.clearTimeout(fitStageTimer);
  }
  state.layoutFreezeUntil = performance.now() + state.performance.resizeDebounceMs + 220;
  fitStageTimer = window.setTimeout(() => {
    fitStage();
    if (state.lowPowerMode) {
      state.particles = [];
    }
  }, state.performance.resizeDebounceMs);
}

function updateLayoutMode() {
  state.iPadLandscape =
    state.iPad && window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
  document.body.classList.toggle("ipad-landscape", state.iPadLandscape);
}

function refreshHint() {
  const tags = [];
  if (state.isWeChat) tags.push("微信");
  if (state.isChromeIOS && state.iPad) tags.push("iPad Chrome");
  if (!secureLike) tags.push("非HTTPS");
  if (!state.supportRecorder || !state.supportCaptureStream) tags.push("无视频录制");
  els.envHint.textContent = tags.length
    ? `家长提示: ${tags.join(" · ")}`
    : "家长提示: 短按快门拍照，长按快门录像";
}

function setActiveOption(container, value, attrName) {
  container?.querySelectorAll(".opt-btn").forEach((button) => {
    button.classList.toggle("active", button.getAttribute(attrName) === value);
  });
}

function markPostEditDirty() {
  if (state.pending) {
    state.postEditDirty = true;
  }
}

function bindOptionSelections() {
  els.effectOptions?.addEventListener("click", (event) => {
    const button = event.target.closest(".opt-btn[data-fx]");
    if (!button) return;
    const fx = button.getAttribute("data-fx");
    if (!fxStyles.includes(fx)) return;
    state.effectId = fx;
    setActiveOption(els.effectOptions, fx, "data-fx");
    setStatus(`✨ 特效: ${button.textContent}`);
    markPostEditDirty();
  });

  els.textStyleOptions?.addEventListener("click", (event) => {
    const button = event.target.closest(".opt-btn[data-text-style]");
    if (!button) return;
    const styleId = button.getAttribute("data-text-style");
    if (!textStyles.includes(styleId)) return;
    state.textStyleId = styleId;
    setActiveOption(els.textStyleOptions, styleId, "data-text-style");
    setStatus(`🔤 文字: ${button.textContent}`);
    markPostEditDirty();
  });

  setActiveOption(els.effectOptions, state.effectId, "data-fx");
  setActiveOption(els.textStyleOptions, state.textStyleId, "data-text-style");
}

function clearSourceVideo() {
  if (state.sourceVideo) {
    state.sourceVideo.pause();
    state.sourceVideo.src = "";
    state.sourceVideo = null;
  }
  if (state.sourceVideoUrl) {
    URL.revokeObjectURL(state.sourceVideoUrl);
    state.sourceVideoUrl = null;
  }
  state.sourceVideoDuration = 0;
}

async function setSourceToCapturedVideo(blob) {
  clearSourceVideo();
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;
  video.loop = true;

  await new Promise((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("captured video load failed"));
  }).catch((error) => {
    console.warn(error);
  });

  try {
    await video.play();
  } catch (error) {
    console.warn("captured video play blocked", error);
  }

  state.sourceMode = "capturedVideo";
  state.sourceVideo = video;
  state.sourceVideoUrl = objectUrl;
  state.sourceVideoDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
}

async function setSourceToCapturedImage(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = url;
  }).catch((error) => {
    console.warn("captured image load failed", error);
  });
  URL.revokeObjectURL(url);
  state.sourceMode = "capturedImage";
  state.sourceImage = image;
  clearSourceVideo();
}

async function prepareMicrophone({ silent = false } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (!silent) {
      setStatus("⚠️ 浏览器不支持麦克风", "error");
    }
    return false;
  }

  if (state.micStream && state.micStream.active && state.micStream.getAudioTracks().length > 0) {
    return true;
  }

  state.micRequested = true;
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    return true;
  } catch (error) {
    console.warn("microphone request failed", error);
    if (!silent) {
      setStatus("⚠️ 麦克风未授权，录像可能无声", "error");
    }
    return false;
  }
}

async function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  els.camera.srcObject = null;
}

async function getCameraStreamWithFallback() {
  const tries = [
    {
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: state.iPad ? 960 : 1280 },
        height: { ideal: state.iPad ? 1280 : 1920 },
      },
      audio: false,
    },
    { video: { facingMode: state.facingMode }, audio: false },
    { video: true, audio: false },
  ];
  for (const req of tries) {
    try {
      return await navigator.mediaDevices.getUserMedia(req);
    } catch (error) {
      console.warn("camera request failed", error);
    }
  }
  return null;
}

async function startCamera() {
  if (!state.supportLiveCamera) {
    setStatus("⚠️ 当前浏览器不支持实时摄像头", "error");
    return false;
  }
  if (!secureLike) {
    setStatus("⚠️ 需要 HTTPS 才能开摄像头", "error");
    return false;
  }
  await stopCamera();
  const stream = await getCameraStreamWithFallback();
  if (!stream) {
    setStatus("⚠️ 摄像头启动失败", "error");
    return false;
  }
  state.stream = stream;
  state.sourceMode = "live";
  state.sourceImage = null;
  clearSourceVideo();
  state.pending = null;
  state.postEditDirty = false;
  els.camera.srcObject = stream;
  try {
    await els.camera.play();
  } catch (error) {
    console.warn(error);
  }
  setStatus("📷 摄像头已就绪");
  return true;
}

function addFloatingText(text, options = {}) {
  if (!text) return;
  const sticky = options.sticky ?? true;
  const x = options.x ?? rand(80, els.stage.width - 80);
  const y = options.y ?? rand(els.stage.height * 0.58, els.stage.height * 0.88);
  const fontSize = options.fontSize ?? rand(28, 44);
  const colors = ["#ffffff", "#ffe082", "#ffd8f0", "#baf4ff", "#bde7bd"];
  state.overlays.push({
    id: state.overlaySeq++,
    text,
    x,
    y,
    vx: sticky ? 0 : rand(-0.35, 0.35),
    vy: sticky ? 0 : rand(-1.45, -0.55),
    life: 0,
    maxLife: sticky ? 999999 : rand(130, 220),
    fontSize,
    color: pick(colors),
    styleId: options.styleId || state.textStyleId,
    sticky,
    hit: null,
  });
  if (state.overlays.length > 60) {
    state.overlays.shift();
  }
  emitBurst(x, y, pick(["#76dbff", "#ffc0df", "#ffd77f"]));
}

function addPresetText() {
  vibrateTap();
  addFloatingText(pick(stickerPhrases), { sticky: true, styleId: state.textStyleId });
  setStatus("➕ 已添加文字，可拖动");
  markPostEditDirty();
}

function emitBurst(x, y, color) {
  for (let i = 0; i < state.performance.burstCount; i += 1) {
    state.particles.push({
      shape: "spark",
      x,
      y,
      vx: rand(-2.2, 2.2),
      vy: rand(-2.2, 2.2),
      size: rand(1.4, 3.6),
      life: 0,
      maxLife: rand(20, 56),
      color,
      rotation: 0,
      vr: 0,
    });
  }
}

function emitEffect() {
  if (state.effectId === "none") return;

  if (state.effectId === "spark" && Math.random() < 0.9) {
    const spawn = Math.random() < 0.55 ? state.performance.sparkSpawnMax : 1;
    for (let i = 0; i < spawn; i += 1) {
      state.particles.push({
        shape: Math.random() < 0.35 ? "star" : "spark",
        x: rand(0, els.stage.width),
        y: rand(0, els.stage.height),
        vx: rand(-0.9, 0.9),
        vy: rand(-1.6, -0.1),
        size: rand(1.8, 5.4),
        life: 0,
        maxLife: rand(38, 110),
        color: pick(["#7dd3ff", "#ffffff", "#9de3d5", "#ffd166"]),
        rotation: rand(0, Math.PI * 2),
        vr: rand(-0.12, 0.12),
      });
    }
  }

  if (state.effectId === "heart" && Math.random() < 0.6) {
    const spawn = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < spawn; i += 1) {
      state.particles.push({
        shape: "heart",
        x: rand(20, els.stage.width - 20),
        y: els.stage.height + 10,
        vx: rand(-0.8, 0.8),
        vy: rand(-2.5, -1.1),
        size: rand(16, 30),
        life: 0,
        maxLife: rand(90, 180),
        color: pick(["#ff4d8f", "#ff7aa8", "#ffc4d8", "#ff5f7f"]),
        rotation: 0,
        vr: 0,
      });
    }
  }

  if (state.effectId === "confetti" && Math.random() < 0.82) {
    const spawn = Math.random() < 0.5 ? state.performance.confettiSpawnMax : 1;
    for (let i = 0; i < spawn; i += 1) {
      state.particles.push({
        shape: Math.random() < 0.25 ? "star" : "confetti",
        x: rand(0, els.stage.width),
        y: -10,
        vx: rand(-1.2, 1.2),
        vy: rand(1.8, 3.6),
        size: rand(6, 12),
        life: 0,
        maxLife: rand(90, 180),
        color: pick(["#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#8ecae6", "#ff7f50"]),
        rotation: rand(0, Math.PI * 2),
        vr: rand(-0.22, 0.22),
      });
    }
  }

  if (state.particles.length > state.performance.maxParticles) {
    state.particles.splice(0, state.particles.length - state.performance.maxParticles);
  }
}

function drawParticles() {
  const next = [];
  for (const p of state.particles) {
    p.life += 1;
    if (p.life > p.maxLife) continue;
    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.vr || 0;
    const alpha = 1 - p.life / p.maxLife;
    ctx.globalAlpha = Math.max(0, alpha);
    if (p.shape === "heart") {
      ctx.fillStyle = p.color;
      ctx.font = `${p.size}px sans-serif`;
      ctx.fillText("❤", p.x, p.y);
    } else if (p.shape === "star") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.font = `${Math.max(10, p.size * 2)}px sans-serif`;
      ctx.fillText("✦", -p.size, p.size);
      ctx.restore();
    } else if (p.shape === "confetti") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.74);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    next.push(p);
  }
  ctx.globalAlpha = 1;
  state.particles = next;
}

function applyTextStyle(t, drawX, drawY) {
  const jitterX = t.styleId === "shake" ? rand(-1.8, 1.8) : 0;
  const jitterY = t.styleId === "shake" ? rand(-1.2, 1.2) : 0;
  const x = drawX + jitterX;
  const y = drawY + jitterY;

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  if (t.styleId === "neon") {
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(11, 36, 61, 0.68)";
    ctx.fillStyle = "#8df5ff";
    ctx.shadowColor = "#4dd8ff";
    ctx.shadowBlur = 12;
  } else if (t.styleId === "fire") {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(80, 20, 0, 0.7)";
    ctx.fillStyle = "#ffe08a";
    ctx.shadowColor = "#ff5b2e";
    ctx.shadowBlur = 12;
  } else if (t.styleId === "candy") {
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.fillStyle = "#ff7ab8";
    ctx.shadowColor = "#ffc0df";
    ctx.shadowBlur = 8;
  } else if (t.styleId === "shake") {
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.42)";
    ctx.fillStyle = "#fff3b0";
  } else {
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.fillStyle = t.color;
  }

  ctx.strokeText(t.text, x, y);
  ctx.fillText(t.text, x, y);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function drawOverlays() {
  const next = [];
  for (const t of state.overlays) {
    t.life += 1;
    if (t.life > t.maxLife) continue;

    if (!t.sticky && state.drag.overlayId !== t.id) {
      t.x += t.vx;
      t.y += t.vy;
      t.vx *= 0.997;
    }

    const alpha = t.sticky ? 1 : 1 - t.life / t.maxLife;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `${Math.floor(t.fontSize)}px "SF Pro Rounded","PingFang SC",sans-serif`;
    ctx.textAlign = "center";
    applyTextStyle(t, t.x, t.y);

    const w = ctx.measureText(t.text).width;
    const h = t.fontSize;
    t.hit = {
      left: t.x - w / 2 - 10,
      right: t.x + w / 2 + 10,
      top: t.y - h - 10,
      bottom: t.y + 10,
    };
    next.push(t);
  }
  ctx.globalAlpha = 1;
  state.overlays = next;
}

function drawGlitchLines() {
  if (state.effectId !== "glitch") return;
  for (let i = 0; i < state.performance.glitchLines; i += 1) {
    if (Math.random() < 0.8) {
      const y = rand(0, els.stage.height);
      const h = rand(4, 16);
      const xShift = rand(-20, 20);
      ctx.fillStyle = `rgba(${Math.floor(rand(120, 255))},${Math.floor(rand(60, 255))},255,0.34)`;
      ctx.fillRect(xShift, y, els.stage.width, h);
    }
  }
}

function drawSpeedLines() {
  if (state.effectId !== "speed") return;
  ctx.globalAlpha = 0.34;
  for (let i = 0; i < state.performance.speedLines; i += 1) {
    ctx.strokeStyle = Math.random() < 0.25 ? "rgba(255,236,163,0.95)" : "rgba(255,255,255,0.95)";
    ctx.lineWidth = rand(1.4, 4.2);
    const y = rand(0, els.stage.height);
    const len = rand(90, 260);
    const startX = rand(-120, els.stage.width);
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + len, y + rand(-14, 14));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function getSourceDimensions(source) {
  if (!source) return null;
  if ("videoWidth" in source && source.videoWidth > 0) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if ("naturalWidth" in source && source.naturalWidth > 0) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return null;
}

function drawSourcePixelated(source, targetWidth, targetHeight) {
  const dims = getSourceDimensions(source);
  if (!dims) return false;
  const basePixel = pixelLevels[state.pixelIndex];
  const previewPixel = state.iPad ? Math.max(1.45, basePixel * 0.68) : Math.max(1.5, basePixel * 0.76);
  const tinyW = Math.max(24, Math.floor(targetWidth / previewPixel));
  const tinyH = Math.max(32, Math.floor(targetHeight / previewPixel));
  if (tinyCanvas.width !== tinyW || tinyCanvas.height !== tinyH) {
    tinyCanvas.width = tinyW;
    tinyCanvas.height = tinyH;
  }

  const srcRatio = dims.width / dims.height;
  const dstRatio = targetWidth / targetHeight;
  let sx = 0;
  let sy = 0;
  let sw = dims.width;
  let sh = dims.height;
  if (srcRatio > dstRatio) {
    sw = Math.floor(dims.height * dstRatio);
    sx = Math.floor((dims.width - sw) / 2);
  } else if (srcRatio < dstRatio) {
    sh = Math.floor(dims.width / dstRatio);
    sy = Math.floor((dims.height - sh) / 2);
  }

  const cameraFilter = state.lowPowerMode
    ? "brightness(1.13) saturate(1.18) contrast(1.06)"
    : "brightness(1.14) saturate(1.2) contrast(1.06)";
  tinyCtx.filter = cameraFilter;
  tinyCtx.drawImage(source, sx, sy, sw, sh, 0, 0, tinyW, tinyH);
  tinyCtx.filter = "none";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tinyCanvas, 0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;

  // Warm lift pass to reduce gray cast while keeping cartoon look.
  ctx.fillStyle = state.lowPowerMode ? "rgba(255, 223, 190, 0.09)" : "rgba(255, 223, 190, 0.1)";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  return true;
}

function resolveRenderSource() {
  if (state.sourceMode === "capturedVideo" && state.sourceVideo && state.sourceVideo.readyState >= 2) {
    return state.sourceVideo;
  }
  if (state.sourceMode === "capturedImage" && state.sourceImage) {
    return state.sourceImage;
  }
  if (els.camera.readyState >= 2) {
    return els.camera;
  }
  return null;
}

function render(ts = 0) {
  const frameBudget = 1000 / state.performance.targetFps;
  if (ts && ts - state.lastRenderTs < frameBudget) {
    state.renderId = window.requestAnimationFrame(render);
    return;
  }
  state.lastRenderTs = ts || performance.now();

  const w = els.stage.width;
  const h = els.stage.height;
  ctx.fillStyle = "#b8d3ec";
  ctx.fillRect(0, 0, w, h);

  const source = resolveRenderSource();
  const drawn = source ? drawSourcePixelated(source, w, h) : false;
  if (!drawn) {
    ctx.fillStyle = "#a7c4df";
    ctx.fillRect(0, 0, w, h);
  }

  const lightFrame = state.saving || performance.now() < state.layoutFreezeUntil;
  if (lightFrame) {
    drawOverlays();
    state.renderId = window.requestAnimationFrame(render);
    return;
  }

  for (let y = 0; y < h; y += state.performance.scanlineStep) {
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    ctx.fillRect(0, y, w, 1);
  }

  emitEffect();
  drawParticles();
  drawOverlays();
  drawGlitchLines();
  drawSpeedLines();

  state.renderId = window.requestAnimationFrame(render);
}

function pickRecorderMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
    return "";
  }
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function cleanupMediaUrls() {
  if (state.mediaUrl) {
    URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = null;
  }
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = null;
  }
  clearSourceVideo();
}

function setPending(blob, type) {
  state.pending = { blob, type };
  state.postEditDirty = false;
  setUiMode("edit", "edit");
  if (type === "video") {
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(blob);
    els.resultVideo.src = state.mediaUrl;
    els.resultVideo.load();
    setSourceToCapturedVideo(blob);
  } else {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = URL.createObjectURL(blob);
    els.resultImage.src = state.imageUrl;
    setSourceToCapturedImage(blob);
  }
}

function clearResultPreview() {
  if (els.resultVideo) {
    els.resultVideo.pause();
    els.resultVideo.removeAttribute("src");
    els.resultVideo.load();
  }
  if (els.resultImage) {
    els.resultImage.removeAttribute("src");
  }
}

async function startNewCreation() {
  setSavingBusy(false);
  state.pending = null;
  state.postEditDirty = false;
  state.overlays = [];
  state.particles = [];
  state.sourceImage = null;
  clearSourceVideo();
  state.sourceMode = "live";
  state.recordingLocked = false;
  setShutterProgress(0);
  els.shutterWrap.classList.remove("recording", "locked");
  setUiMode("capture", "capture");
  clearResultPreview();
  setStatus("🆕 新的一轮开始");

  if (!state.stream || state.stream.getTracks().every((track) => track.readyState !== "live")) {
    await startCamera();
  }
}

async function captureCurrentImageBlob() {
  return new Promise((resolve) => {
    els.stage.toBlob(
      resolve,
      state.performance.imageBlobType,
      state.performance.imageBlobQuality
    );
  });
}

async function autoSaveBlob(blob, type) {
  setSavingBusy(true);
  const isVideo = type === "video";
  const ts = Date.now();
  const ext = isVideo ? (blob.type.includes("mp4") ? "mp4" : "webm") : blob.type.includes("jpeg") ? "jpg" : "png";
  const fileName = `facelab-kids-${ts}.${ext}`;
  const mime = blob.type || (isVideo ? "video/webm" : "image/png");

  if (isVideo) {
    els.downloadVideo.href = state.mediaUrl || URL.createObjectURL(blob);
    els.downloadVideo.download = fileName;
  } else {
    els.downloadImage.href = state.imageUrl || URL.createObjectURL(blob);
    els.downloadImage.download = fileName;
  }

  const file = new File([blob], fileName, { type: mime });
  try {
    if (navigator.share) {
      try {
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: "FaceLab",
            text: "保存到相册",
          });
          setStatus("✅ 已弹出保存面板");
          return true;
        }
      } catch (error) {
        console.warn("share failed", error);
      }
    }

    try {
      const link = isVideo ? els.downloadVideo : els.downloadImage;
      link.click();
      setStatus("✅ 已自动下载");
      return true;
    } catch (error) {
      console.warn("download click failed", error);
      setStatus("✅ 请长按预览存相册");
      return false;
    }
  } finally {
    setSavingBusy(false);
  }
}

async function snapPhoto(saveImmediately = false) {
  const blob = await captureCurrentImageBlob();
  if (!blob) {
    setStatus("❌ 拍照失败", "error");
    return;
  }
  setPending(blob, "image");
  setStatus("📸 已拍照，点✅完成保存");
  if (saveImmediately) {
    await autoSaveBlob(blob, "image");
  }
}

async function exportComposedVideoFromCanvas(durationSec) {
  if (!state.supportRecorder || !state.supportCaptureStream) {
    return null;
  }

  const source = resolveRenderSource();
  if (!source) {
    return null;
  }

  if (state.sourceMode === "capturedVideo" && state.sourceVideo) {
    try {
      state.sourceVideo.currentTime = 0;
      await state.sourceVideo.play();
    } catch (error) {
      console.warn("captured video restart failed", error);
    }
  }

  const canvasStream = els.stage.captureStream(state.performance.exportCaptureFps);
  const mimeType = pickRecorderMime();
  let recorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(canvasStream, {
          mimeType,
          videoBitsPerSecond: state.performance.composeBitrate,
        })
      : new MediaRecorder(canvasStream);
  } catch (error) {
    console.warn("compose recorder init failed", error);
    canvasStream.getTracks().forEach((track) => track.stop());
    return null;
  }

  const chunks = [];
  const done = new Promise((resolve) => {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      canvasStream.getTracks().forEach((track) => track.stop());
      resolve(blob);
    };
  });

  recorder.start(220);
  const ms = Math.max(1200, Math.min(10000, Math.floor(durationSec * 1000)));
  window.setTimeout(() => {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }, ms);

  return done;
}

function stopRecordProgressLoop() {
  if (state.recordProgressRaf) {
    cancelAnimationFrame(state.recordProgressRaf);
    state.recordProgressRaf = 0;
  }
}

function runRecordProgressLoop() {
  stopRecordProgressLoop();
  const tick = () => {
    if (!state.recording) return;
    const elapsed = Date.now() - state.recordStartTs;
    const pct = Math.min(1, elapsed / state.recordMaxMs);
    setShutterProgress(pct);
    if (pct >= 1) {
      stopRecording(false);
      return;
    }
    state.recordProgressRaf = requestAnimationFrame(tick);
  };
  state.recordProgressRaf = requestAnimationFrame(tick);
}

async function startRecording({ locked = false } = {}) {
  if (state.recording) return;
  if (!state.supportRecorder || !state.supportCaptureStream) {
    setStatus("⚠️ 当前浏览器不支持录像", "error");
    return;
  }

  const canvasStream = els.stage.captureStream(state.performance.exportCaptureFps);
  const micReady = await prepareMicrophone({ silent: true });
  if (micReady && state.micStream) {
    state.micStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
  } else {
    setStatus("⚠️ 麦克风未就绪，本次录像可能无声", "error");
  }

  const mimeType = pickRecorderMime();
  let recorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(canvasStream, {
          mimeType,
          videoBitsPerSecond: state.performance.exportBitrate,
        })
      : new MediaRecorder(canvasStream);
  } catch (error) {
    setStatus("⚠️ 无法开始录像", "error");
    canvasStream.getTracks().forEach((track) => track.stop());
    return;
  }

  state.chunks = [];
  state.recorder = recorder;
  state.recording = true;
  state.recordingLocked = locked;
  state.recordStartTs = Date.now();
  els.shutterWrap.classList.add("recording");
  els.shutterWrap.classList.toggle("locked", state.recordingLocked);
  setUiMode("recording", "recording");
  setStatus("🔴 录制中，可继续选特效");
  setShutterProgress(0);
  runRecordProgressLoop();

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    const blob = new Blob(state.chunks, { type: mimeType || "video/webm" });
    setPending(blob, "video");
    if (state.autoSaveAfterStop) {
      const shouldReset = state.resetAfterSave;
      state.autoSaveAfterStop = false;
      state.resetAfterSave = false;
      autoSaveBlob(blob, "video").then((saved) => {
        if (saved && shouldReset) {
          finalizeSaveAndReset(true);
        }
      });
    } else {
      setStatus("🎬 录制完成，点✅完成保存");
    }

    canvasStream.getTracks().forEach((track) => track.stop());
  };

  recorder.start(220);
}

function stopRecording(saveImmediately) {
  if (!state.recording) return;
  state.autoSaveAfterStop = saveImmediately;
  state.recording = false;
  state.recordingLocked = false;
  stopRecordProgressLoop();
  setShutterProgress(0);
  els.shutterWrap.classList.remove("recording", "locked");
  if (state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  }
}

function onShutterPointerDown(event) {
  event.preventDefault();
  if (state.recording || state.saving) return;
  vibrateTap();
  if (state.press.active) return;
  state.press.active = true;
  state.press.pointerId = event.pointerId;
  state.press.longTriggered = false;
  els.shutterBtn.setPointerCapture(event.pointerId);
  state.press.timer = window.setTimeout(async () => {
    if (!state.press.active) return;
    state.press.longTriggered = true;
    await startRecording({ locked: true });
  }, 320);
}

function onShutterPointerUp(event) {
  if (!state.press.active || state.press.pointerId !== event.pointerId) return;
  clearTimeout(state.press.timer);
  if (state.press.longTriggered) {
    state.press.active = false;
    state.press.pointerId = null;
    state.press.longTriggered = false;
    return;
  } else {
    snapPhoto(false);
  }
  state.press.active = false;
  state.press.pointerId = null;
  state.press.longTriggered = false;
}

function onShutterPointerCancel(event) {
  if (!state.press.active || state.press.pointerId !== event.pointerId) return;
  clearTimeout(state.press.timer);
  if (state.recording && !state.recordingLocked) stopRecording(false);
  state.press.active = false;
  state.press.pointerId = null;
  state.press.longTriggered = false;
}

async function onDoneClick() {
  vibrateTap();
  if (state.recording) {
    state.resetAfterSave = true;
    setStatus("⏹️ 正在结束并保存");
    stopRecording(true);
    return;
  }
  if (state.pending) {
    if (state.pending.type === "video" && state.postEditDirty) {
      const durationSec = state.sourceVideoDuration > 0 ? Math.min(10, state.sourceVideoDuration) : 4;
      setStatus("✨ 正在合成特效视频");
      const composed = await exportComposedVideoFromCanvas(durationSec);
      if (composed) {
        setPending(composed, "video");
        const saved = await autoSaveBlob(composed, "video");
        await finalizeSaveAndReset(saved);
      } else {
        const saved = await autoSaveBlob(state.pending.blob, "video");
        await finalizeSaveAndReset(saved);
      }
      return;
    }
    if (state.pending.type === "image" && state.postEditDirty) {
      const composedImage = await captureCurrentImageBlob();
      if (composedImage) {
        setPending(composedImage, "image");
        const saved = await autoSaveBlob(composedImage, "image");
        await finalizeSaveAndReset(saved);
      } else {
        const saved = await autoSaveBlob(state.pending.blob, "image");
        await finalizeSaveAndReset(saved);
      }
      return;
    }
    const saved = await autoSaveBlob(state.pending.blob, state.pending.type);
    await finalizeSaveAndReset(saved);
    return;
  }
  const blob = await captureCurrentImageBlob();
  if (blob) {
    setPending(blob, "image");
    const saved = await autoSaveBlob(blob, "image");
    await finalizeSaveAndReset(saved);
  }
}

function getCanvasPoint(event) {
  const rect = els.stage.getBoundingClientRect();
  const scaleX = els.stage.width / rect.width;
  const scaleY = els.stage.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function findOverlayAt(x, y) {
  for (let i = state.overlays.length - 1; i >= 0; i -= 1) {
    const t = state.overlays[i];
    if (!t.hit) continue;
    if (x >= t.hit.left && x <= t.hit.right && y >= t.hit.top && y <= t.hit.bottom) {
      return t;
    }
  }
  return null;
}

function handleStagePointerDown(event) {
  const p = getCanvasPoint(event);
  const target = findOverlayAt(p.x, p.y);
  if (!target) return;
  state.drag.active = true;
  state.drag.overlayId = target.id;
  state.drag.pointerId = event.pointerId;
  state.drag.offsetX = p.x - target.x;
  state.drag.offsetY = p.y - target.y;
  target.sticky = true;
  target.vx = 0;
  target.vy = 0;
  target.maxLife = 999999;
  target.life = 0;
  els.stage.setPointerCapture(event.pointerId);
  setStatus("✋ 拖动文字中");
}

function handleStagePointerMove(event) {
  if (!state.drag.active || state.drag.pointerId !== event.pointerId) return;
  const p = getCanvasPoint(event);
  const target = state.overlays.find((item) => item.id === state.drag.overlayId);
  if (!target) return;
  target.x = Math.max(20, Math.min(els.stage.width - 20, p.x - state.drag.offsetX));
  target.y = Math.max(30, Math.min(els.stage.height - 16, p.y - state.drag.offsetY));
}

function handleStagePointerEnd(event) {
  if (!state.drag.active || state.drag.pointerId !== event.pointerId) return;
  state.drag.active = false;
  state.drag.overlayId = null;
  state.drag.pointerId = null;
  setStatus("📍 文字已放好");
  markPostEditDirty();
}

function bindEvents() {
  els.addTextBtn.addEventListener("click", addPresetText);
  els.doneBtn.addEventListener("click", onDoneClick);
  els.shutterBtn.addEventListener("pointerdown", onShutterPointerDown);
  els.shutterBtn.addEventListener("pointerup", onShutterPointerUp);
  els.shutterBtn.addEventListener("pointercancel", onShutterPointerCancel);
  els.shutterBtn.addEventListener("lostpointercapture", onShutterPointerCancel);

  els.stage.addEventListener("pointerdown", handleStagePointerDown);
  els.stage.addEventListener("pointermove", handleStagePointerMove);
  els.stage.addEventListener("pointerup", handleStagePointerEnd);
  els.stage.addEventListener("pointercancel", handleStagePointerEnd);

  bindOptionSelections();

  document.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest(".app-shell")) {
      event.preventDefault();
    }
  });
  document.addEventListener("selectstart", (event) => {
    if (event.target instanceof Element && event.target.closest(".app-shell")) {
      event.preventDefault();
    }
  });

  window.addEventListener("resize", scheduleFitStage, { passive: true });
  window.addEventListener("orientationchange", () => {
    updateLayoutMode();
    state.layoutFreezeUntil = performance.now() + 320;
    state.lastRenderTs = 0;
    scheduleFitStage();
  });
  window.addEventListener("beforeunload", () => {
    if (fitStageTimer) {
      window.clearTimeout(fitStageTimer);
      fitStageTimer = 0;
    }
    stopRecordProgressLoop();
    stopRecording(false);
    cleanupMediaUrls();
    if (state.micStream) {
      state.micStream.getTracks().forEach((track) => track.stop());
      state.micStream = null;
    }
    stopCamera();
    window.cancelAnimationFrame(state.renderId);
  });
}

async function bootstrap() {
  setUiMode("capture", "capture");
  updateLayoutMode();
  fitStage();
  refreshHint();
  bindEvents();
  render();
  setStatus("👋 短按拍照，长按录像");
  await startCamera();
  const micReady = await prepareMicrophone({ silent: true });
  if (micReady) {
    setStatus("📷🎙️ 摄像头和麦克风已就绪");
  } else if (state.micRequested) {
    setStatus("📷 已就绪，麦克风待授权", "error");
  }
}

bootstrap();
