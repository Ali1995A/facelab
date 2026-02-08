# FaceLab

静态网页表情包相机，适配 Vercel 部署，支持：

- 前置摄像头自拍（可切换前后摄）
- 像素风实时画面
- 常用表情包文字 + 粒子特效
- 即时语音识别并生成漂浮字幕
- 录制数秒短视频并导出（表情包）
- iPad Pro 一代性能优化
- 微信内浏览器兼容模式（拍照导入 / 录像导入）
- 儿童简化交互（大图标按钮，无需读字）

## 本地运行

直接打开 `index.html` 也可用，但摄像头/语音在部分浏览器要求 `https` 或 `localhost`。

推荐命令：

```bash
npx serve .
```

## 部署到 Vercel

1. 将仓库推送到 GitHub
2. 在 Vercel 导入该仓库
3. Framework 选择 `Other`，无需构建命令
4. Output 目录留空（根目录静态文件）

## 推送到 GitHub

```bash
git init
git add .
git commit -m "feat: init facelab static meme camera"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

## 兼容性说明

- 语音识别依赖 `SpeechRecognition / webkitSpeechRecognition`（Safari 与 Chrome 支持情况不同）
- 视频录制依赖 `MediaRecorder`，会自动选择可用编码（`mp4` 或 `webm`）
- iPad 保存：可长按预览视频后选择“存储到照片”
- 微信内浏览器：若实时摄像头受限，可使用“微信拍照导入 / 微信录像导入”继续制作

## 儿童模式操作

- `🚀` 开始相机（默认前置）
- `😆` 随机贴纸文字
- `✨` 切换特效
- `🧊` 切换像素强度
- `🎤` 语音漂浮字幕开关
- `📸` 拍照，`🎬` 录制 4 秒
