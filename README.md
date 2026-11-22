# 入卷 · 清明上河图（一段）

把清院本《清明上河图》中的一段（全卷 x = 17800–23800 px，约 150 m × 85 m 的街区）还原成可以漫游的 3D 场景，在浏览器里直接打开即可：https://yinita.github.io/qingming-3d/

- 人物、车马、树木是从画中抠出的纸片，按 30° 斜投影放回地面；纸片经 Real-ESRGAN 放大到原画的 2 倍。树用十字纸片，脚下有接地阴影。
- 房屋换成了 3D 模型（Hunyuan3D-2 生成形状，每座取 4 次生成里与画中轮廓最贴合的一次）。画里看得见的面直接用原画；背面和侧面用同一座房子的屋顶、墙面样本平铺。
- 地面是抠掉所有物体后的原画，空出来的地方用 LaMa 补全。
- 查看器有四种视角：画卷视角（与原画重合）、飞入画中、漫游（WASD）、俯瞰。左上角按钮可在房屋 3D 模型和纸片之间切换。

## 来源与许可

- 原画：清院本《清明上河图》，取自 Wikimedia Commons 上标为公有领域的扫描。
- 房屋 3D 模型（`data/seg01/scene/meshes/*.glb`）由 [Hunyuan3D-2](https://github.com/Tencent/Hunyuan3D-2) 生成，受 Tencent Hunyuan Non-Commercial License 约束：仅限非商业使用，且该许可不适用于欧盟、英国和韩国境内。
- 地面补全用 [LaMa](https://github.com/advimman/lama)（Apache-2.0），纸片放大用 [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)（BSD-3-Clause）。
- 查看器代码基于 [three.js](https://threejs.org/)（MIT 许可），通过 CDN 加载。
