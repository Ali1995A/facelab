const els = {
  startCameraBtn: document.getElementById("startCameraBtn"),
  switchCameraBtn: document.getElementById("switchCameraBtn"),
  snapBtn: document.getElementById("snapBtn"),
  uploadImageBtn: document.getElementById("uploadImageBtn"),
  uploadVideoBtn: document.getElementById("uploadVideoBtn"),
  uploadImageInput: document.getElementById("uploadImageInput"),
  uploadVideoInput: document.getElementById("uploadVideoInput"),
  clearBtn: document.getElementById("clearBtn"),
  pixelRange: document.getElementById("pixelRange"),
  memeTextSelect: document.getElementById("memeTextSelect"),
  addMemeTextBtn: document.getElementById("addMemeTextBtn"),
  effectSelect: document.getElementById("effectSelect"),
  speechBtn: document.getElementById("speechBtn"),
  manualTextInput: document.getElementById("manualTextInput"),
  manualTextBtn: document.getElementById("manualTextBtn"),
  durationRange: document.getElementById("durationRange"),
  durationLabel: document.getElementById("durationLabel"),
  recordBtn: document.getElementById("recordBtn"),
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
  pixelSize: 8,
  overlays: [],
  particles: [],
  effect: "none",
  interimText: "",
  speechWanted: false,
  recognition: null,
  recording: false,
  recordDeadline: 0,
  renderId: 0,
  mediaUrl: null,
  imageUrl: null,
  iPad: /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  isWeChat: /micromessenger/.test(lowUA),
  isIOS: /iphone|ipad|ipod/.test(lowUA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  isChromeIOS: /crios/.test(lowUA),
  supportLiveCamera: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  supportSpeech: Boolean(speechClass),
  supportRecorder: Boolean(window.MediaRecorder),
  supportCaptureStream: typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function",
};

state.iPadChrome = state.iPad && state.isChromeIOS;

const ctx = els.stage.getContext("2d", { alpha: false, desynchronized: true });
const tinyCanvas = document.createElement("canvas");
const tinyCtx = tinyCanvas.getContext("2d", { alpha: false });

if (state.iPad) {
  els.pixelRange.value = "10";
}
state.pixelSize = Number(els.pixelRange.value);
els.durationLabel.textContent = `${els.durationRange.value}s`;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function setStatus(text, mode = "info") {
  els.status.textContent = text;
  els.status.style.borderColor =
    mode === "error" ? "rgba(255,100,85,0.55)" : "rgba(255,255,255,0.2)";
}

function fitStage() {
  const container = els.stage.parentElement;
  const containerWidth = Math.max(320, Math.floor(container.clientWidth - 24));
  const baseWidth = Math.min(containerWidth, state.iPad ? 560 : 720);
  const width = baseWidth % 2 === 0 ? baseWidth : baseWidth - 1;
  const height = Math.floor((width * 4) / 3);
  els.stage.width = width;
  els.stage.height = height;
}

function disableUnsupportedControls() {
  if (!state.supportLiveCamera || !secureLike) {
    els.startCameraBtn.disabled = true;
    els.switchCameraBtn.disabled = true;
  }
  if (!state.supportSpeech) {
    els.speechBtn.disabled = true;
    els.speechBtn.textContent = "语音不可用";
  }
  if (!state.supportRecorder || !state.supportCaptureStream) {
    els.recordBtn.disabled = true;
  }
}

function refreshEnvironmentHint() {
  const tags = [];
  if (state.isWeChat) tags.push("微信内浏览器");
  if (state.iPadChrome) tags.push("iPad Chrome");
  if (!secureLike) tags.push("非HTTPS环境");
  if (!state.supportLiveCamera) tags.push("实时摄像头不可用");
  if (!state.supportSpeech) tags.push("语音识别不可用");
  if (!state.supportRecorder || !state.supportCaptureStream) tags.push("视频录制受限");

  const modeHint = tags.length ? tags.join(" · ") : "当前浏览器功能完整";
  const fallbackHint = state.isWeChat
    ? "微信里建议优先用“拍照导入/录像导入”"
    : "建议使用 HTTPS，功能更完整";
  els.envHint.textContent = `${modeHint} | ${fallbackHint}`;
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

function resetLiveSource() {
  state.sourceMode = "live";
  state.sourceImage = null;
  stopSourceVideo();
}

function activateImageSource(image) {
  stopCamera();
  stopSourceVideo();
  state.sourceImage = image;
  state.sourceMode = "image";
  setStatus("已导入照片，效果可继续叠加");
}

function activateVideoSource(video, objectUrl) {
  stopCamera();
  stopSourceVideo();
  state.sourceVideo = video;
  state.sourceVideoUrl = objectUrl;
  state.sourceMode = "video";
  setStatus("已导入视频，可继续叠加特效并导出");
}

async function getCameraStreamWithFallback() {
  const requests = [
    {
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: state.iPad ? 960 : 1280 },
        height: { ideal: state.iPad ? 1280 : 1920 },
      },
      audio: false,
    },
    {
      video: {
        facingMode: state.facingMode,
      },
      audio: false,
    },
    { video: true, audio: false },
  ];

  for (const req of requests) {
    try {
      return await navigator.mediaDevices.getUserMedia(req);
    } catch (error) {
      console.warn("camera try failed", req, error);
    }
  }
  return null;
}

async function startCamera() {
  if (!state.supportLiveCamera) {
    setStatus("当前浏览器不支持实时摄像头，请用拍照导入", "error");
    return;
  }
  if (!secureLike) {
    setStatus("需要 HTTPS 才能调用摄像头", "error");
    return;
  }

  await stopCamera();
  resetLiveSource();

  const stream = await getCameraStreamWithFallback();
  if (!stream) {
    setStatus("无法启动摄像头，请改用拍照导入或录像导入", "error");
    return;
  }

  state.stream = stream;
  els.camera.srcObject = stream;
  try {
    await els.camera.play();
  } catch (error) {
    console.warn("camera play blocked", error);
  }
  setStatus(`摄像头已启动（${state.facingMode === "user" ? "前置" : "后置"}）`);
}

function addFloatingText(text, source = "manual") {
  if (!text) return;
  const x = rand(80, els.stage.width - 80);
  const y = rand(els.stage.height * 0.55, els.stage.height * 0.9);
  const fontSize = source === "speech" ? rand(24, 34) : rand(28, 44);
  const colors = ["#ffffff", "#ffe082", "#ffccbc", "#b2f5ea", "#fbcfe8"];
  state.overlays.push({
    text,
    x,
    y,
    vx: rand(-0.35, 0.35),
    vy: rand(-1.5, -0.6),
    life: 0,
    maxLife: rand(130, 210),
    fontSize,
    color: pick(colors),
  });
  if (state.overlays.length > 40) {
    state.overlays.shift();
  }
  emitBurst(x, y, pick(["#7dd3ff", "#f8b4b4", "#f9e2a0"]));
}

function emitBurst(x, y, color) {
  for (let i = 0; i < 14; i += 1) {
    state.particles.push({
      shape: "spark",
      x,
      y,
      vx: rand(-1.8, 1.8),
      vy: rand(-1.8, 1.8),
      size: rand(1.5, 3.4),
      life: 0,
      maxLife: rand(18, 48),
      color,
    });
  }
}

function emitEffect() {
  if (state.effect === "none") {
    return;
  }

  if (state.effect === "spark" && Math.random() < 0.65) {
    state.particles.push({
      shape: "spark",
      x: rand(0, els.stage.width),
      y: rand(0, els.stage.height),
      vx: rand(-0.2, 0.2),
      vy: rand(-0.8, -0.1),
      size: rand(0.8, 2.2),
      life: 0,
      maxLife: rand(25, 80),
      color: pick(["#7dd3ff", "#f7f7f7", "#9de3d5"]),
    });
  }

  if (state.effect === "heart" && Math.random() < 0.35) {
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

  if (state.particles.length > 260) {
    state.particles.splice(0, state.particles.length - 260);
  }
}

function drawParticles() {
  const next = [];
  for (const p of state.particles) {
    p.life += 1;
    if (p.life > p.maxLife) {
      continue;
    }
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
    if (t.life > t.maxLife) {
      continue;
    }
    t.x += t.vx;
    t.y += t.vy;
    t.vx *= 0.997;
    const alpha = 1 - t.life / t.maxLife;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `${Math.floor(t.fontSize)}px "ZCOOL KuaiLe","Noto Sans SC",sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,0.58)";
    ctx.fillStyle = t.color;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
    next.push(t);
  }
  ctx.globalAlpha = 1;
  state.overlays = next;

  if (state.interimText) {
    const label = state.interimText.slice(0, 28);
    ctx.font = `700 ${Math.floor(els.stage.width * 0.035)}px "Noto Sans SC",sans-serif`;
    ctx.textAlign = "center";
    const x = els.stage.width / 2;
    const y = els.stage.height - 26;
    const width = Math.max(140, ctx.measureText(label).width + 28);
    const height = 34;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x - width / 2, y - height + 8, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x, y);
  }
}

function drawGlitchLines() {
  if (state.effect !== "glitch") {
    return;
  }
  for (let i = 0; i < 4; i += 1) {
    if (Math.random() < 0.5) {
      const y = rand(0, els.stage.height);
      const h = rand(3, 10);
      ctx.fillStyle = `rgba(${Math.floor(rand(80, 220))},${Math.floor(rand(120, 240))},255,0.18)`;
      ctx.fillRect(0, y, els.stage.width, h);
    }
  }
}

function drawRecordHUD() {
  if (!state.recording) {
    return;
  }
  const remain = Math.max(0, Math.ceil((state.recordDeadline - Date.now()) / 1000));
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(12, 12, 124, 36);
  ctx.fillStyle = "#ff6b5b";
  ctx.beginPath();
  ctx.arc(28, 30, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 18px Noto Sans SC,sans-serif";
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

  const tinyW = Math.max(18, Math.floor(targetWidth / state.pixelSize));
  const tinyH = Math.max(24, Math.floor(targetHeight / state.pixelSize));
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
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  const source = resolveRenderSource();
  const drawn = source ? drawSourcePixelated(source, w, h) : false;
  if (!drawn) {
    ctx.fillStyle = "#22354a";
    ctx.fillRect(0, 0, w, h);
  }

  for (let y = 0; y < h; y += 4) {
    ctx.fillStyle = "rgba(0,0,0,0.08)";
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
  const list = [
    "video/mp4;codecs=h264,aac",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const type of list) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
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
  const blob = await new Promise((resolve) => {
    els.stage.toBlob(resolve, "image/png", 0.95);
  });
  if (!blob) {
    setStatus("拍照失败", "error");
    return;
  }
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
  }
  state.imageUrl = URL.createObjectURL(blob);
  els.downloadImage.href = state.imageUrl;
  els.downloadImage.download = `facelab-${Date.now()}.png`;
  els.resultImage.src = state.imageUrl;
  setStatus("已生成图片，可下载或长按保存");
}

async function recordClip() {
  if (!state.supportRecorder || !state.supportCaptureStream) {
    setStatus("当前浏览器不支持视频录制，可改用拍照导出", "error");
    return;
  }
  if (state.recording) {
    return;
  }

  const source = resolveRenderSource();
  if (!source) {
    setStatus("请先启动摄像头或导入素材", "error");
    return;
  }

  const seconds = Number(els.durationRange.value);
  const canvasStream = els.stage.captureStream(state.iPad ? 22 : 30);

  try {
    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    state.audioStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
  } catch (error) {
    console.warn("microphone unavailable", error);
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
    setStatus("录制初始化失败", "error");
    canvasStream.getTracks().forEach((track) => track.stop());
    return;
  }

  state.chunks = [];
  state.recording = true;
  state.recordDeadline = Date.now() + seconds * 1000;
  state.recorder = recorder;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    state.recording = false;
    const blobType = mimeType || "video/webm";
    const blob = new Blob(state.chunks, { type: blobType });
    if (state.mediaUrl) {
      URL.revokeObjectURL(state.mediaUrl);
    }
    state.mediaUrl = URL.createObjectURL(blob);
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    els.downloadVideo.href = state.mediaUrl;
    els.downloadVideo.download = `facelab-${Date.now()}.${ext}`;
    els.resultVideo.src = state.mediaUrl;
    els.resultVideo.load();
    setStatus("录制完成，可下载或长按预览保存");

    canvasStream.getTracks().forEach((track) => track.stop());
    if (state.audioStream) {
      state.audioStream.getTracks().forEach((track) => track.stop());
      state.audioStream = null;
    }
  };

  recorder.start(220);
  setStatus(`正在录制 ${seconds}s`);
  window.setTimeout(() => {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }, seconds * 1000);
}

function ensureSpeechRecognition() {
  if (!speechClass) {
    setStatus("语音识别不可用，请使用手动文字", "error");
    els.manualTextInput.focus();
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

  recognition.onerror = (event) => {
    setStatus(`语音识别异常: ${event.error}`, "error");
  };

  recognition.onend = () => {
    state.interimText = "";
    if (state.speechWanted) {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch (error) {
          console.warn("speech restart failed", error);
        }
      }, 280);
    }
  };

  return recognition;
}

function toggleSpeech() {
  if (!state.recognition) {
    state.recognition = ensureSpeechRecognition();
    if (!state.recognition) {
      return;
    }
  }

  if (!state.speechWanted) {
    state.speechWanted = true;
    try {
      state.recognition.start();
      els.speechBtn.textContent = "关闭语音转字幕";
      setStatus("语音识别已开启，说话会生成漂浮字幕");
    } catch (error) {
      setStatus("无法开启语音识别，请使用手动文字", "error");
      state.speechWanted = false;
    }
    return;
  }

  state.speechWanted = false;
  try {
    state.recognition.stop();
  } catch (error) {
    console.warn(error);
  }
  state.interimText = "";
  els.speechBtn.textContent = "开启语音转字幕";
  setStatus("语音识别已关闭");
}

function clearOverlays() {
  state.overlays = [];
  state.particles = [];
  state.interimText = "";
  setStatus("文字和特效已清空");
}

function addManualText() {
  const value = els.manualTextInput.value.trim();
  if (!value) {
    return;
  }
  addFloatingText(value, "manual");
  els.manualTextInput.value = "";
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
    setStatus("图片导入失败", "error");
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
      console.warn("video autoplay blocked", error);
    }
    activateVideoSource(video, objectUrl);
  };
  video.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    setStatus("视频导入失败", "error");
  };
}

function bindEvents() {
  els.startCameraBtn.addEventListener("click", startCamera);
  els.switchCameraBtn.addEventListener("click", async () => {
    state.facingMode = state.facingMode === "user" ? "environment" : "user";
    await startCamera();
  });
  els.snapBtn.addEventListener("click", snapPhoto);
  els.uploadImageBtn.addEventListener("click", () => els.uploadImageInput.click());
  els.uploadVideoBtn.addEventListener("click", () => els.uploadVideoInput.click());
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
  els.addMemeTextBtn.addEventListener("click", () => {
    addFloatingText(els.memeTextSelect.value, "manual");
  });
  els.manualTextBtn.addEventListener("click", addManualText);
  els.manualTextInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addManualText();
    }
  });
  els.effectSelect.addEventListener("change", () => {
    state.effect = els.effectSelect.value;
  });
  els.pixelRange.addEventListener("input", () => {
    state.pixelSize = Number(els.pixelRange.value);
  });
  els.durationRange.addEventListener("input", () => {
    els.durationLabel.textContent = `${els.durationRange.value}s`;
  });
  els.speechBtn.addEventListener("click", toggleSpeech);
  els.recordBtn.addEventListener("click", recordClip);
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
  refreshEnvironmentHint();
  disableUnsupportedControls();
  bindEvents();
  render();

  if (state.isWeChat) {
    setStatus("微信兼容模式：优先使用“拍照导入/录像导入”", "info");
    return;
  }
  if (state.iPadChrome) {
    setStatus("iPad Chrome 模式已优化，建议先点“启动摄像头”");
    return;
  }
  setStatus(state.iPad ? "iPad 优化模式已启用，建议先点“启动摄像头”" : "准备就绪，点击“启动摄像头”");
}

bootstrap();
