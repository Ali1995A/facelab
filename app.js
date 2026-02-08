const els = {
  startCameraBtn: document.getElementById("startCameraBtn"),
  switchCameraBtn: document.getElementById("switchCameraBtn"),
  stickerBtn: document.getElementById("stickerBtn"),
  effectBtn: document.getElementById("effectBtn"),
  pixelBtn: document.getElementById("pixelBtn"),
  speechBtn: document.getElementById("speechBtn"),
  snapBtn: document.getElementById("snapBtn"),
  recordBtn: document.getElementById("recordBtn"),
  uploadImageBtn: document.getElementById("uploadImageBtn"),
  uploadVideoBtn: document.getElementById("uploadVideoBtn"),
  uploadImageInput: document.getElementById("uploadImageInput"),
  uploadVideoInput: document.getElementById("uploadVideoInput"),
  clearBtn: document.getElementById("clearBtn"),
  stage: document.getElementById("stage"),
  camera: document.getElementById("camera"),
  status: document.getElementById("status"),
  envHint: document.getElementById("envHint"),
  resultVideo: document.getElementById("resultVideo"),
  resultImage: document.getElementById("resultImage"),
  downloadImage: document.getElementById("downloadImage"),
  downloadVideo: document.getElementById("downloadVideo"),
};

const ua = navigator.userAgent;
const lowUA = ua.toLowerCase();
const speechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
const secureLike =
  window.isSecureContext ||
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1";

const stickerPhrases = [
  "哇哦",
  "冲呀",
  "太可爱啦",
  "耶",
  "嘻嘻",
  "我最棒",
  "开心到飞起",
  "biu biu",
];

const effects = [
  { id: "none", icon: "✨" },
  { id: "spark", icon: "🌟" },
  { id: "heart", icon: "💖" },
  { id: "glitch", icon: "⚡" },
];

const pixelLevels = [6, 8, 10, 12];
const pixelIcons = ["🧊", "🟦", "🟪", "🟫"];

const state = {
  facingMode: "user",
  stream: null,
  sourceMode: "none",
  sourceImage: null,
  sourceVideo: null,
  sourceVideoUrl: null,
  recorder: null,
  audioStream: null,
  chunks: [],
  overlays: [],
  particles: [],
  interimText: "",
  speechWanted: false,
  recognition: null,
  recording: false,
  recordSeconds: 4,
  recordDeadline: 0,
  renderId: 0,
  mediaUrl: null,
  imageUrl: null,
  effectIndex: 0,
  pixelIndex: 1,
  iPad: /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  isWeChat: /micromessenger/.test(lowUA),
  isChromeIOS: /crios/.test(lowUA),
  supportLiveCamera: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  supportSpeech: Boolean(speechClass),
  supportRecorder: Boolean(window.MediaRecorder),
  supportCaptureStream:
    typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function",
};

state.iPadChrome = state.iPad && state.isChromeIOS;
if (state.iPad) {
  state.pixelIndex = 2;
}

const ctx = els.stage.getContext("2d", { alpha: false, desynchronized: true });
const tinyCanvas = document.createElement("canvas");
const tinyCtx = tinyCanvas.getContext("2d", { alpha: false });

function vibrateTap() {
  if (navigator.vibrate) {
    navigator.vibrate(10);
  }
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

function fitStage() {
  const parent = els.stage.parentElement;
  const width = Math.max(320, Math.min(parent.clientWidth - 20, state.iPad ? 620 : 760));
  const evenWidth = width % 2 === 0 ? width : width - 1;
  const height = Math.floor((evenWidth * 4) / 3);
  els.stage.width = evenWidth;
  els.stage.height = height;
}

function refreshHint() {
  const tags = [];
  if (state.isWeChat) tags.push("微信");
  if (state.iPadChrome) tags.push("iPad Chrome");
  if (!secureLike) tags.push("非HTTPS");
  if (!state.supportSpeech) tags.push("无语音");
  els.envHint.textContent = tags.length
    ? `家长提示: ${tags.join(" · ")}，可用拍照/录像导入模式`
    : "家长提示: 点击🚀开拍，📸拍图，🎬录4秒";
}

function updateToolIcons() {
  els.effectBtn.textContent = effects[state.effectIndex].icon;
  els.pixelBtn.textContent = pixelIcons[state.pixelIndex];
  els.speechBtn.textContent = state.speechWanted ? "🛑" : "🎤";
}

function stopSourceVideo() {
  if (state.sourceVideo) {
    state.sourceVideo.pause();
    state.sourceVideo.src = "";
    state.sourceVideo = null;
  }
  if (state.sourceVideoUrl) {
    URL.revokeObjectURL(state.sourceVideoUrl);
    state.sourceVideoUrl = null;
  }
}

async function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  els.camera.srcObject = null;
}

function clearSourcesToLive() {
  state.sourceMode = "live";
  state.sourceImage = null;
  stopSourceVideo();
}

function activateImageSource(image) {
  stopCamera();
  stopSourceVideo();
  state.sourceMode = "image";
  state.sourceImage = image;
  setStatus("🖼️ 已装进相机");
}

function activateVideoSource(video, objectUrl) {
  stopCamera();
  stopSourceVideo();
  state.sourceMode = "video";
  state.sourceVideo = video;
  state.sourceVideoUrl = objectUrl;
  setStatus("🎞️ 已装进相机");
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
  vibrateTap();
  if (!state.supportLiveCamera) {
    setStatus("⚠️ 不支持实时相机", "error");
    return;
  }
  if (!secureLike) {
    setStatus("⚠️ 需HTTPS才能开相机", "error");
    return;
  }
  await stopCamera();
  clearSourcesToLive();
  const stream = await getCameraStreamWithFallback();
  if (!stream) {
    setStatus("⚠️ 开相机失败，可用🖼️/🎞️", "error");
    return;
  }
  state.stream = stream;
  els.camera.srcObject = stream;
  try {
    await els.camera.play();
  } catch (error) {
    console.warn(error);
  }
  setStatus(state.facingMode === "user" ? "🤳 前置镜头开启" : "📷 后置镜头开启");
}

function addFloatingText(text, source = "manual") {
  if (!text) return;
  const x = rand(80, els.stage.width - 80);
  const y = rand(els.stage.height * 0.55, els.stage.height * 0.9);
  const fontSize = source === "speech" ? rand(24, 34) : rand(28, 44);
  const colors = ["#ffffff", "#ffe082", "#ffd8f0", "#baf4ff", "#bde7bd"];
  state.overlays.push({
    text,
    x,
    y,
    vx: rand(-0.35, 0.35),
    vy: rand(-1.45, -0.55),
    life: 0,
    maxLife: rand(130, 220),
    fontSize,
    color: pick(colors),
  });
  if (state.overlays.length > 44) {
    state.overlays.shift();
  }
  emitBurst(x, y, pick(["#76dbff", "#ffc0df", "#ffd77f"]));
}

function addSticker() {
  vibrateTap();
  addFloatingText(pick(stickerPhrases), "manual");
  setStatus("😆 贴纸+1");
}

function cycleEffect() {
  vibrateTap();
  state.effectIndex = (state.effectIndex + 1) % effects.length;
  updateToolIcons();
  emitBurst(els.stage.width * 0.5, els.stage.height * 0.45, "#ffd77f");
  setStatus(`✨ 特效切换 ${effects[state.effectIndex].icon}`);
}

function cyclePixel() {
  vibrateTap();
  state.pixelIndex = (state.pixelIndex + 1) % pixelLevels.length;
  updateToolIcons();
  setStatus("🧊 像素风切换");
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
    });
  }
}

function emitEffect() {
  const effect = effects[state.effectIndex].id;
  if (effect === "none") return;

  if (effect === "spark" && Math.random() < 0.65) {
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
    });
  }

  if (effect === "heart" && Math.random() < 0.35) {
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
    });
  }

  if (state.particles.length > 280) {
    state.particles.splice(0, state.particles.length - 280);
  }
}

function drawParticles() {
  const next = [];
  for (const p of state.particles) {
    p.life += 1;
    if (p.life > p.maxLife) continue;
    p.x += p.vx;
    p.y += p.vy;
    const alpha = 1 - p.life / p.maxLife;
    ctx.globalAlpha = Math.max(0, alpha);
    if (p.shape === "heart") {
      ctx.fillStyle = p.color;
      ctx.font = `${p.size}px sans-serif`;
      ctx.fillText("❤", p.x, p.y);
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

function drawOverlays() {
  const next = [];
  for (const t of state.overlays) {
    t.life += 1;
    if (t.life > t.maxLife) continue;
    t.x += t.vx;
    t.y += t.vy;
    t.vx *= 0.997;
    const alpha = 1 - t.life / t.maxLife;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `${Math.floor(t.fontSize)}px "SF Pro Rounded","PingFang SC",sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.fillStyle = t.color;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
    next.push(t);
  }
  ctx.globalAlpha = 1;
  state.overlays = next;

  if (state.interimText) {
    const label = state.interimText.slice(0, 22);
    ctx.font = `700 ${Math.floor(els.stage.width * 0.04)}px "SF Pro Rounded","PingFang SC",sans-serif`;
    ctx.textAlign = "center";
    const x = els.stage.width / 2;
    const y = els.stage.height - 30;
    const boxW = Math.max(140, ctx.measureText(label).width + 30);
    ctx.fillStyle = "rgba(255,255,255,0.76)";
    ctx.fillRect(x - boxW / 2, y - 32, boxW, 36);
    ctx.fillStyle = "#1f3f63";
    ctx.fillText(label, x, y - 6);
  }
}

function drawGlitchLines() {
  if (effects[state.effectIndex].id !== "glitch") {
    return;
  }
  for (let i = 0; i < 4; i += 1) {
    if (Math.random() < 0.45) {
      const y = rand(0, els.stage.height);
      const h = rand(3, 10);
      ctx.fillStyle = `rgba(${Math.floor(rand(120, 255))},${Math.floor(rand(120, 255))},255,0.22)`;
      ctx.fillRect(0, y, els.stage.width, h);
    }
  }
}

function drawRecordHUD() {
  if (!state.recording) return;
  const remain = Math.max(0, Math.ceil((state.recordDeadline - Date.now()) / 1000));
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillRect(12, 12, 104, 36);
  ctx.fillStyle = "#e64437";
  ctx.beginPath();
  ctx.arc(28, 30, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f3f63";
  ctx.font = "700 18px SF Pro Rounded,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${remain}s`, 42, 36);
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
  const pixel = pixelLevels[state.pixelIndex];
  const tinyW = Math.max(18, Math.floor(targetWidth / pixel));
  const tinyH = Math.max(24, Math.floor(targetHeight / pixel));
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
  if (state.sourceMode === "live" && els.camera.readyState >= 2) {
    return els.camera;
  }
  if (state.sourceMode === "video" && state.sourceVideo && state.sourceVideo.readyState >= 2) {
    return state.sourceVideo;
  }
  if (state.sourceMode === "image" && state.sourceImage) {
    return state.sourceImage;
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
  stopSourceVideo();
}

async function snapPhoto() {
  vibrateTap();
  const blob = await new Promise((resolve) => {
    els.stage.toBlob(resolve, "image/png", 0.95);
  });
  if (!blob) {
    setStatus("❌ 拍照失败", "error");
    return;
  }
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = URL.createObjectURL(blob);
  els.resultImage.src = state.imageUrl;
  els.downloadImage.href = state.imageUrl;
  els.downloadImage.download = `facelab-kids-${Date.now()}.png`;
  setStatus("📸 完成，可点⬇️🖼️");
}

async function recordClip() {
  vibrateTap();
  if (!state.supportRecorder || !state.supportCaptureStream) {
    setStatus("⚠️ 录制不可用", "error");
    return;
  }
  if (state.recording) return;
  if (!resolveRenderSource()) {
    setStatus("⚠️ 先开相机或导入", "error");
    return;
  }

  const seconds = state.recordSeconds;
  const stream = els.stage.captureStream(state.iPad ? 22 : 30);
  try {
    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    state.audioStream.getAudioTracks().forEach((track) => stream.addTrack(track));
  } catch (error) {
    console.warn("no mic track", error);
  }

  const mimeType = pickRecorderMime();
  let recorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: state.iPad ? 1500000 : 2500000,
        })
      : new MediaRecorder(stream);
  } catch (error) {
    setStatus("❌ 无法录制", "error");
    stream.getTracks().forEach((track) => track.stop());
    return;
  }

  state.chunks = [];
  state.recording = true;
  state.recordDeadline = Date.now() + seconds * 1000;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    state.recording = false;
    const blob = new Blob(state.chunks, { type: mimeType || "video/webm" });
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(blob);
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    els.resultVideo.src = state.mediaUrl;
    els.resultVideo.load();
    els.downloadVideo.href = state.mediaUrl;
    els.downloadVideo.download = `facelab-kids-${Date.now()}.${ext}`;
    setStatus("🎬 完成，可点⬇️🎬");

    stream.getTracks().forEach((track) => track.stop());
    if (state.audioStream) {
      state.audioStream.getTracks().forEach((track) => track.stop());
      state.audioStream = null;
    }
  };

  recorder.start(220);
  setStatus(`🔴 录制 ${seconds}s`);
  window.setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, seconds * 1000);
}

function ensureSpeechRecognition() {
  if (!speechClass) {
    setStatus("⚠️ 没有语音功能", "error");
    return null;
  }
  const recognition = new speechClass();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0].transcript.trim();
      if (!text) continue;
      if (event.results[i].isFinal) {
        addFloatingText(text, "speech");
      } else {
        interim += text;
      }
    }
    state.interimText = interim;
  };

  recognition.onerror = () => {
    setStatus("⚠️ 语音识别异常", "error");
  };

  recognition.onend = () => {
    state.interimText = "";
    if (state.speechWanted) {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch (error) {
          console.warn(error);
        }
      }, 250);
    }
  };
  return recognition;
}

function toggleSpeech() {
  vibrateTap();
  if (!state.recognition) {
    state.recognition = ensureSpeechRecognition();
    if (!state.recognition) return;
  }

  if (!state.speechWanted) {
    state.speechWanted = true;
    try {
      state.recognition.start();
      setStatus("🎤 说话会变成漂浮字");
    } catch (error) {
      state.speechWanted = false;
      setStatus("⚠️ 语音暂时不可用", "error");
    }
  } else {
    state.speechWanted = false;
    try {
      state.recognition.stop();
    } catch (error) {
      console.warn(error);
    }
    state.interimText = "";
    setStatus("🎤 已关闭");
  }
  updateToolIcons();
}

function clearOverlays() {
  vibrateTap();
  state.overlays = [];
  state.particles = [];
  state.interimText = "";
  setStatus("🧹 清空啦");
}

function loadImageFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    activateImageSource(image);
    URL.revokeObjectURL(url);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus("❌ 图片导入失败", "error");
  };
  image.src = url;
}

function loadVideoFile(file) {
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.src = objectUrl;
  video.onloadeddata = async () => {
    try {
      await video.play();
    } catch (error) {
      console.warn("video play blocked", error);
    }
    activateVideoSource(video, objectUrl);
  };
  video.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    setStatus("❌ 视频导入失败", "error");
  };
}

function disableUnsupportedControls() {
  if (!state.supportLiveCamera || !secureLike) {
    els.startCameraBtn.disabled = true;
    els.switchCameraBtn.disabled = true;
  }
  if (!state.supportSpeech) {
    els.speechBtn.disabled = true;
  }
  if (!state.supportRecorder || !state.supportCaptureStream) {
    els.recordBtn.disabled = true;
  }
}

function bindEvents() {
  els.startCameraBtn.addEventListener("click", startCamera);
  els.switchCameraBtn.addEventListener("click", async () => {
    vibrateTap();
    state.facingMode = state.facingMode === "user" ? "environment" : "user";
    await startCamera();
  });
  els.stickerBtn.addEventListener("click", addSticker);
  els.effectBtn.addEventListener("click", cycleEffect);
  els.pixelBtn.addEventListener("click", cyclePixel);
  els.speechBtn.addEventListener("click", toggleSpeech);
  els.snapBtn.addEventListener("click", snapPhoto);
  els.recordBtn.addEventListener("click", recordClip);
  els.uploadImageBtn.addEventListener("click", () => {
    vibrateTap();
    els.uploadImageInput.click();
  });
  els.uploadVideoBtn.addEventListener("click", () => {
    vibrateTap();
    els.uploadVideoInput.click();
  });
  els.uploadImageInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    loadImageFile(file);
    event.target.value = "";
  });
  els.uploadVideoInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    loadVideoFile(file);
    event.target.value = "";
  });
  els.clearBtn.addEventListener("click", clearOverlays);

  window.addEventListener("resize", fitStage, { passive: true });
  window.addEventListener("orientationchange", fitStage, { passive: true });
  window.addEventListener("beforeunload", () => {
    cleanupMediaUrls();
    stopCamera();
    if (state.recognition && state.speechWanted) {
      state.speechWanted = false;
      state.recognition.stop();
    }
    window.cancelAnimationFrame(state.renderId);
  });
}

function bootstrap() {
  fitStage();
  refreshHint();
  updateToolIcons();
  disableUnsupportedControls();
  bindEvents();
  render();

  if (state.isWeChat) {
    setStatus("👋 微信里可直接点🖼️或🎞️");
    return;
  }
  if (state.iPadChrome) {
    setStatus("👋 iPad Chrome 已优化");
    return;
  }
  setStatus("👋 点🚀开始");
}

bootstrap();
