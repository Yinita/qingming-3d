# 桥头水面与漂叶

从仓库根目录运行 `python3 -m http.server 8133 --bind 127.0.0.1`，再打开对应机位。

- [骤雨、街面径流和浅滩](http://127.0.0.1:8133/viewer/?mission&rain&gust)
- [阵风、落叶和船浪](http://127.0.0.1:8133/viewer/?mission&gust&swell)
- [移动镜头与桥栏倒影](http://127.0.0.1:8133/viewer/?mission&gust)

| 实机近景 | 验收记录 |
| --- | --- |
| [街面入河](rain-runoff.jpg) | [水量收支与漂叶](rain-runoff.json) |
| [浅滩和湿石对照](shoreline.jpg) | [地形射线核对](shoreline.json)、[退水湿痕](retreat.json) |
| [桥栏倒影对照](reflection.jpg) | [超采样参考与帧间隔](reflection.json) |
| [漂叶细波对照](leaf-contact.jpg) | [入水、漂移与再浮](leaf-contact.json) |

同帧对照左侧启用当前效果，右侧展示对应的基线。仓库里的截图为缩图，验收记录来自 3840 × 2160 的实机渲染。

可以用 Node.js 24 执行 `node tools/verify_shallow_water.mjs` 与 `node tools/verify_street_runoff.mjs` 检查求解器。浏览器验收脚本位于 `tools/`，使用 Python、Playwright 和 Chrome。
