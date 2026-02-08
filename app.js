const els = {
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

const state = {
  facingMode: "user",
  stream: null,
  chunks: [],
  overlays: [],
  particles: [],
  recording: false,
  recorder: null,
  autoSaveAfterStop: false,
  recordStartTs: 0,
  recordMaxMs: 10000,
  recordProgressRaf: 0,
  renderId: 0,
  overlaySeq: 1,
  effectId: "none",
  textStyleId: "classic",
  pixelIndex: 1,
  mediaUrl: null,
  imageUrl: null,
  pending: null,
  audioStream: null,
  iPad: /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  isWeChat: /micromessenger/.test(lowUA),
  isChromeIOS: /crios/.test(lowUA),
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

if (state.iPad) {
  state.pixelIndex = 1;
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

function setShutterProgress(value0to1) {
  const pct = Math.max(0, Math.min(1, value0to1));
  els.shutterWrap.style.setProperty("--progress", `${pct * 100}%`);
}

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
      state.iPad ? (isLandscape ? 760 : 620) : 760,
      maxWidthByHeight
    )
  );
  const evenWidth = width % 2 === 0 ? width : width - 1;
  const height = Math.floor((evenWidth * 4) / 3);
  els.stage.width = evenWidth;
  els.stage.height = height;
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

function bindOptionSelections() {
  els.effectOptions?.addEventListener("click", (event) => {
    const button = event.target.closest(".opt-btn[data-fx]");
    if (!button) return;
    const fx = button.getAttribute("data-fx");
    if (!fxStyles.includes(fx)) return;
    state.effectId = fx;
    setActiveOption(els.effectOptions, fx, "data-fx");
    setStatus(`✨ 特效: ${button.textContent}`);
  });

  els.textStyleOptions?.addEventListener("click", (event) => {
    const button = event.target.closest(".opt-btn[data-text-style]");
    if (!button) return;
    const styleId = button.getAttribute("data-text-style");
    if (!textStyles.includes(styleId)) return;
    state.textStyleId = styleId;
    setActiveOption(els.textStyleOptions, styleId, "data-text-style");
    setStatus(`🔤 文字: ${button.textContent}`);
  });

  setActiveOption(els.effectOptions, state.effectId, "data-fx");
  setActiveOption(els.textStyleOptions, state.textStyleId, "data-text-style");
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
}

function emitBurst(x, y, color) {
  for (let i = 0; i < 14; i += 1) {
    state.particles.push({
      shape: "spark",
      x,
      y,
      vx: rand(-1.8, 1.8),
      vy: rand(-1.8, 1.8),
      size: rand(1.4, 3.2),
      life: 0,
      maxLife: rand(20, 50),
      color,
      rotation: 0,
      vr: 0,
    });
  }
}

function emitEffect() {
  if (state.effectId === "none") return;

  if (state.effectId === "spark" && Math.random() < 0.65) {
    state.particles.push({
      shape: "spark",
      x: rand(0, els.stage.width),
      y: rand(0, els.stage.height),
      vx: rand(-0.2, 0.2),
      vy: rand(-0.8, -0.1),
      size: rand(0.8, 2.2),
      life: 0,
      maxLife: rand(25, 80),
      color: pick(["#7dd3ff", "#ffffff", "#9de3d5"]),
      rotation: 0,
      vr: 0,
    });
  }

  if (state.effectId === "heart" && Math.random() < 0.35) {
    state.particles.push({
      shape: "heart",
      x: rand(30, els.stage.width - 30),
      y: els.stage.height + 8,
      vx: rand(-0.5, 0.5),
      vy: rand(-1.6, -0.8),
      size: rand(12, 20),
      life: 0,
      maxLife: rand(70, 130),
      color: pick(["#ff8ba7", "#fda4af", "#fecdd3"]),
      rotation: 0,
      vr: 0,
    });
  }

  if (state.effectId === "confetti" && Math.random() < 0.55) {
    state.particles.push({
      shape: "confetti",
      x: rand(0, els.stage.width),
      y: -10,
      vx: rand(-0.9, 0.9),
      vy: rand(1.4, 2.8),
      size: rand(4, 8),
      life: 0,
      maxLife: rand(60, 130),
      color: pick(["#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#8ecae6"]),
      rotation: rand(0, Math.PI * 2),
      vr: rand(-0.16, 0.16),
    });
  }

  if (state.particles.length > 320) {
    state.particles.splice(0, state.particles.length - 320);
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
    } else if (p.shape === "confetti") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
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
  for (let i = 0; i < 4; i += 1) {
    if (Math.random() < 0.45) {
      const y = rand(0, els.stage.height);
      const h = rand(3, 10);
      ctx.fillStyle = `rgba(${Math.floor(rand(120, 255))},${Math.floor(rand(120, 255))},255,0.22)`;
      ctx.fillRect(0, y, els.stage.width, h);
    }
  }
}

function drawSpeedLines() {
  if (state.effectId !== "speed") return;
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i += 1) {
    const y = rand(0, els.stage.height);
    const len = rand(50, 180);
    const startX = rand(-80, els.stage.width);
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + len, y + rand(-8, 8));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawRecordHUD() {
  if (!state.recording) return;
  const remain = Math.max(0, Math.ceil((state.recordMaxMs - (Date.now() - state.recordStartTs)) / 1000));
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillRect(12, 12, 122, 36);
  ctx.fillStyle = "#18a54d";
  ctx.beginPath();
  ctx.arc(28, 30, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f3f63";
  ctx.font = "700 16px SF Pro Rounded,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`录制 ${remain}s`, 42, 35);
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
  const previewPixel = state.iPad ? Math.max(1.8, basePixel * 0.85) : Math.max(1.6, basePixel * 0.8);
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

  tinyCtx.drawImage(source, sx, sy, sw, sh, 0, 0, tinyW, tinyH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tinyCanvas, 0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  return true;
}

function resolveRenderSource() {
  if (els.camera.readyState >= 2) {
    return els.camera;
  }
  return null;
}

function render() {
  const w = els.stage.width;
  const h = els.stage.height;
  ctx.fillStyle = "#a9c0dc";
  ctx.fillRect(0, 0, w, h);

  const source = resolveRenderSource();
  const drawn = source ? drawSourcePixelated(source, w, h) : false;
  if (!drawn) {
    ctx.fillStyle = "#90a8c4";
    ctx.fillRect(0, 0, w, h);
  }

  for (let y = 0; y < h; y += 4) {
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    ctx.fillRect(0, y, w, 1);
  }

  emitEffect();
  drawParticles();
  drawOverlays();
  drawGlitchLines();
  drawSpeedLines();
  drawRecordHUD();

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
}

function setPending(blob, type) {
  state.pending = { blob, type };
  if (type === "video") {
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(blob);
    els.resultVideo.src = state.mediaUrl;
    els.resultVideo.load();
  } else {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = URL.createObjectURL(blob);
    els.resultImage.src = state.imageUrl;
  }
}

async function autoSaveBlob(blob, type) {
  const isVideo = type === "video";
  const ts = Date.now();
  const ext = isVideo ? (blob.type.includes("mp4") ? "mp4" : "webm") : "png";
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
}

async function snapPhoto(saveImmediately = false) {
  const blob = await new Promise((resolve) => {
    els.stage.toBlob(resolve, "image/png", 0.95);
  });
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

async function startRecording() {
  if (state.recording) return;
  if (!state.supportRecorder || !state.supportCaptureStream) {
    setStatus("⚠️ 当前浏览器不支持录像", "error");
    return;
  }

  const canvasStream = els.stage.captureStream(state.iPad ? 22 : 30);
  try {
    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    state.audioStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
  } catch (error) {
    console.warn("no mic track", error);
  }

  const mimeType = pickRecorderMime();
  let recorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(canvasStream, {
          mimeType,
          videoBitsPerSecond: state.iPad ? 1500000 : 2500000,
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
  state.recordStartTs = Date.now();
  els.shutterWrap.classList.add("recording");
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
      autoSaveBlob(blob, "video");
      state.autoSaveAfterStop = false;
    } else {
      setStatus("🎬 录制完成，点✅完成保存");
    }

    canvasStream.getTracks().forEach((track) => track.stop());
    if (state.audioStream) {
      state.audioStream.getTracks().forEach((track) => track.stop());
      state.audioStream = null;
    }
  };

  recorder.start(220);
}

function stopRecording(saveImmediately) {
  if (!state.recording) return;
  state.autoSaveAfterStop = saveImmediately;
  state.recording = false;
  stopRecordProgressLoop();
  setShutterProgress(0);
  els.shutterWrap.classList.remove("recording");
  if (state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  }
}

function onShutterPointerDown(event) {
  event.preventDefault();
  vibrateTap();
  if (state.press.active) return;
  state.press.active = true;
  state.press.pointerId = event.pointerId;
  state.press.longTriggered = false;
  els.shutterBtn.setPointerCapture(event.pointerId);
  state.press.timer = window.setTimeout(async () => {
    if (!state.press.active) return;
    state.press.longTriggered = true;
    await startRecording();
  }, 320);
}

function onShutterPointerUp(event) {
  if (!state.press.active || state.press.pointerId !== event.pointerId) return;
  clearTimeout(state.press.timer);
  if (state.press.longTriggered) {
    if (state.recording) {
      stopRecording(false);
    }
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
  if (state.recording) stopRecording(false);
  state.press.active = false;
  state.press.pointerId = null;
  state.press.longTriggered = false;
}

async function onDoneClick() {
  vibrateTap();
  if (state.recording) {
    stopRecording(true);
    return;
  }
  if (state.pending) {
    await autoSaveBlob(state.pending.blob, state.pending.type);
    return;
  }
  await snapPhoto(true);
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

  window.addEventListener("resize", fitStage, { passive: true });
  window.addEventListener("orientationchange", () => {
    updateLayoutMode();
    fitStage();
  });
  window.addEventListener("beforeunload", () => {
    stopRecordProgressLoop();
    stopRecording(false);
    cleanupMediaUrls();
    stopCamera();
    window.cancelAnimationFrame(state.renderId);
  });
}

async function bootstrap() {
  updateLayoutMode();
  fitStage();
  refreshHint();
  bindEvents();
  render();
  setStatus("👋 短按拍照，长按录像");
  await startCamera();
}

bootstrap();
