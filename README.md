# FaceLab

静态网页表情包相机，适配 Vercel 部署，支持：

- 前置摄像头自拍（可切换前后摄）
- 像素风实时画面
- 常用表情包文字 + 粒子特效
- 即时语音识别并生成漂浮字幕
- 录制数秒短视频并导出（表情包）
- iPad Pro 一代性能优化
- iPad 横屏布局优化（舞台左侧、操作右侧）
- 微信内浏览器兼容模式（拍照导入 / 录像导入）
- 儿童超简化交互（1个主按钮）
- 表情包常用特效选项（无/火花/爱心/故障/彩纸/速度线）
- 文字特效选项（经典/霓虹/火焰/糖果/抖动）
- 文字可在画布中拖动摆放
- 实时预览像素优化（减少马赛克，保留轻像素风）

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
- 自动保存链路：优先尝试系统分享面板（可“存储到照片”），失败时自动下载文件
- iPad 保存：若未直接入相册，可在分享面板点“存储到照片”或长按预览保存
- 微信内浏览器：若实时摄像头受限，可使用“微信拍照导入 / 微信录像导入”继续制作

## 儿童模式操作

- `🪄` 一键完成：自动开拍 + 自动特效 + 自动录制/拍照 + 自动保存
- `➕字` 添加常用文字（可拖动到任意位置）
- 选项条可切换画面特效与文字特效
- `🔄` 切前后镜头（家长备用）
- `🖼️` 导入照片（微信/受限浏览器备用）
- `🎞️` 导入视频（微信/受限浏览器备用）
