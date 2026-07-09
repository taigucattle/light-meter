# 胶片测光表 (Film Light Meter)

为胶片摄影爱好者打造的 Zone System 点测光 PWA。在 iPhone Safari 中打开，添加到主屏幕即可像原生 App 一样使用。

## 功能

- **多点测光** — 点击取景画面任意位置添加测光点，支持无限多点
- **Zone System 尺子** — 11 档 Zone 可视化，拖动尺子放置测光点，实时显示快门速度
- **画幅框线** — 支持 135 / 120 6×6 / 6×7 / 6×4.5 / 6×9，模拟焦距取景范围
- **斑马纹** — 超出胶片动态范围的高光/暗部实时警告
- **曝光预览** — 一键预览当前曝光设置下的画面明暗
- **胶片数据库** — 40+ 胶卷的特性曲线数据（动态范围、反差系数、趾部/肩部、倒易律）
- **倒易律补偿** — Schwarzschild 模型自动计算长曝光补偿
- **滤镜补偿** — 16 种常用滤镜的档位补偿
- **快门靠档** — 自动向最近的 1/3 档标准快门速度靠拢
- **自动读取曝光参数** — iOS 16+ Safari 直接读取摄像头真实曝光时间和 ISO
- **校准支持** — 支持手动校准以确保精度
- **离线可用** — PWA 安装后可离线使用（飞行模式下也能测光）

## 使用方法

### 在 iPhone 上使用

1. 用 Safari 打开部署后的网址（GitHub Pages 或本地服务器）
2. 点击底部「分享」→「添加到主屏幕」
3. 主屏幕上会出现「测光表」图标，点击即可全屏使用

### 操作流程

1. 选择画幅和焦距 → 取景框线自动显示
2. 选择胶片 → ISO 自动设置
3. 设定光圈
4. 点击取景画面添加测光点
5. 拖动底部 Zone 尺子放置测光区
6. 读取快门速度

## 技术栈

- 纯 HTML/CSS/JS（无框架，无构建工具）
- ES Modules
- PWA（Service Worker + Web App Manifest）
- iOS Safari `getUserMedia` + `MediaTrackSettings`

## 本地开发

```bash
# 使用 HTTPS 启动本地服务器（摄像头需要 HTTPS）
npx http-server -S -C cert.pem -K key.pem -p 8080

# 或使用 Python（仅 HTTP，无摄像头——用于 UI 调试）
python -m http.server 8080
```

iPhone 同 WiFi 下访问 `https://<你的电脑IP>:8080`。

## 部署到 GitHub Pages

1. 在 GitHub 创建仓库
2. 推送代码
3. Settings → Pages → Source: main branch → Save
4. 等待几分钟，访问 `https://<用户名>.github.io/<仓库名>/`

## 项目结构

```
light-measuring/
├── index.html          # 主页面 + iOS PWA meta 标签
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (离线缓存)
├── css/
│   └── style.css       # 暗色主题样式
├── js/
│   ├── app.js          # 主控制器 + 状态管理
│   ├── camera.js       # 摄像头访问 + 帧采样
│   ├── lightmeter.js   # EV 计算 + Zone System + 曝光三角
│   ├── films.js        # 胶片数据库 (40+ stocks)
│   └── ui.js           # 界面渲染 + Zone尺子 + 斑马纹
├── icons/              # PWA 图标
└── README.md
```

## 许可

MIT
