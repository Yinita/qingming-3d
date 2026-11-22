# 入卷 · 清明上河图（一段）

把清院本《清明上河图》中的一段（全卷 x = 17800–23800 px）还原成可以漫游的 3D 场景，在浏览器里直接打开即可。

- 人物、车马、树木是从画中抠出的纸片，按 30° 斜投影放回地面。
- 34 座房屋换成了 3D 模型。画里看得见的面直接用原画；背面和侧面用同一座房子的屋顶、墙面样本平铺。
- 查看器有四种视角：画卷视角（与原画重合）、飞入画中、漫游（WASD）、俯瞰。左上角按钮可在房屋 3D 模型和纸片之间切换。

## 来源与许可

- 原画：清院本《清明上河图》，取自 Wikimedia Commons 上标为公有领域的扫描。
- 房屋 3D 模型（`data/seg01/scene/meshes/*.glb`）由 [Hunyuan3D-2](https://github.com/Tencent/Hunyuan3D-2) 生成，受 Tencent Hunyuan Non-Commercial License 约束：仅限非商业使用，且该许可不适用于欧盟、英国和韩国境内。
- 查看器代码基于 [three.js](https://threejs.org/)（MIT 许可），通过 CDN 加载。
