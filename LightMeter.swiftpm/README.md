# Light Meter — Swift Playgrounds 测光表

iPad Swift Playgrounds 原生 App。直接读取摄像头曝光参数（exposureDuration、ISO、lensAperture），不用任何校准。

## 安装到 iPad

1. 把整个 `LightMeter.swiftpm` 文件夹传到 iPad（AirDrop / iCloud / 微信文件传输）
2. 在 iPad 上打开「文件」App，找到这个文件夹
3. 长按 → 「共享」→ 选择「Swift Playgrounds」
4. Swift Playgrounds 会自动打开项目
5. 点右上角 ▶ 运行

## 功能

- 真实摄像头曝光参数（AVCaptureDevice）
- Zone System 多点测光
- 快门速度自动靠标准档位
- 暗色界面（省电 + 护眼）
