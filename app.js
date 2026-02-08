const els = {
  startCameraBtn: document.getElementById("startCameraBtn"),
  switchCameraBtn: document.getElementById("switchCameraBtn"),
  snapBtn: document.getElementById("snapBtn"),
  clearBtn: document.getElementById("clearBtn"),
  pixelRange: document.getElementById("pixelRange"),
  memeTextSelect: document.getElementById("memeTextSelect"),
  addMemeTextBtn: document.getElementById("addMemeTextBtn"),
  effectSelect: document.getElementById("effectSelect"),
  speechBtn: document.getElementById("speechBtn"),
  durationRange: document.getElementById("durationRange"),
  durationLabel: document.getElementById("durationLabel"),
  recordBtn: document.getElementById("recordBtn"),
  stage: document.getElementById("stage"),
  camera: document.getElementById("camera"),
  status: document.getElementById("status"),
  resultVideo: document.getElementById("resultVideo"),
  resultImage: document.getElementById("resultImage"),
  downloadImage: document.getElementById("downloadImage"),
  downloadVideo: document.getElementById("downloadVideo"),
};

const state = {
  facingMode: "user",
  stream: null,
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
  iPad:
    /iPad/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
};

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
  const baseWidth = Math.min(containerWidth, state.iPad ? 600 : 720);
  const width = baseWidth % 2 === 0 ? baseWidth : baseWidth - 1;
  const height = Math.floor((width * 4) / 3);
  els.stage.width = width;
  els.stage.height = height;
}

async function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("当前浏览器不支持摄像头", "error");
    return;
  }

  await stopCamera();

  const request = {
    video: {
      facingMode: { ideal: state.facingMode },
      width: { ideal: state.iPad ? 960 : 1280 },
      height: { ideal: state.iPad ? 1280 : 1920 },
    },
    audio: false,
  };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(request);
    els.camera.srcObject = state.stream;
    await els.camera.play();
    setStatus(`摄像头已启动（${state.facingMode === "user" ? "前置" : "后置"}）`);
  } catch (error) {
    setStatus("无法启动摄像头，请确认已授权访问", "error");
    console.error(error);
  }
}

function addFloatingText(text, source = "manual") {
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
  ctx.font = `700 18px "Noto Sans SC",sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`${remain}s`, 42, 36);
}

function render() {
  const w = els.stage.width;
  const h = els.stage.height;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  const hasVideo = els.camera.readyState >= 2;
  if (hasVideo) {
    const tinyW = Math.max(18, Math.floor(w / state.pixelSize));
    const tinyH = Math.max(24, Math.floor(h / state.pixelSize));
    if (tinyCanvas.width !== tinyW || tinyCanvas.height !== tinyH) {
      tinyCanvas.width = tinyW;
      tinyCanvas.height = tinyH;
    }
    tinyCtx.drawImage(els.camera, 0, 0, tinyW, tinyH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tinyCanvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  } else {
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
  if (!window.MediaRecorder) {
    setStatus("当前浏览器不支持录制", "error");
    return;
  }
  if (state.recording) {
    return;
  }
  if (!state.stream) {
    setStatus("请先启动摄像头", "error");
    return;
  }

  const seconds = Number(els.durationRange.value);
  const canvasStream = els.stage.captureStream(state.iPad ? 24 : 30);

  try {
    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    const tracks = state.audioStream.getAudioTracks();
    tracks.forEach((track) => canvasStream.addTrack(track));
  } catch (error) {
    console.warn("No audio track for recording", error);
  }

  const mimeType = pickRecorderMime();
  let recorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(canvasStream, {
          mimeType,
          videoBitsPerSecond: state.iPad ? 1600000 : 2500000,
        })
      : new MediaRecorder(canvasStream);
  } catch (error) {
    setStatus("录制初始化失败", "error");
    console.error(error);
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
  const Cls = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Cls) {
    setStatus("浏览器不支持语音识别", "error");
    return null;
  }
  const recognition = new Cls();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0].transcript.trim();
      if (!text) {
        continue;
      }
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
      console.error(error);
      setStatus("无法开启语音识别", "error");
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

function bindEvents() {
  els.startCameraBtn.addEventListener("click", startCamera);
  els.switchCameraBtn.addEventListener("click", async () => {
    state.facingMode = state.facingMode === "user" ? "environment" : "user";
    await startCamera();
  });
  els.snapBtn.addEventListener("click", snapPhoto);
  els.clearBtn.addEventListener("click", clearOverlays);
  els.addMemeTextBtn.addEventListener("click", () => {
    addFloatingText(els.memeTextSelect.value, "manual");
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
  bindEvents();
  render();
  setStatus(
    state.iPad
      ? "iPad 优化模式已启用，建议先点“启动摄像头”"
      : "准备就绪，点击“启动摄像头”"
  );
}

bootstrap();
