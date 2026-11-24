# 入卷 · 清明上河图（一段）

把清院本《清明上河图》中的一段（全卷 x = 17800–23800 px，约 150 m × 85 m 的街区）还原成可以漫游的 3D 场景，在浏览器里直接打开即可：https://yinita.github.io/qingming-3d/

- 人物、车马、树木是从画中抠出的纸片，按 30° 斜投影放回地面；纸片经 Real-ESRGAN 放大到原画的 2 倍。树用十字纸片，脚下有接地阴影。
- 房屋换成了 3D 模型（Hunyuan3D-2 生成形状，每座取 4 次生成里与画中轮廓最贴合的一次）。画里看得见的面直接用原画；背面和侧面用同一座房子的屋顶、墙面样本平铺。
- 地面是抠掉所有物体后的原画，空出来的地方用 LaMa 补全。
- 查看器支持画卷、飞入画中、漫游和俯瞰。画卷使用原画裁片。透视视角使用立体人物、树木、车马与房屋，材质随照明变化。

## 桥畔茶铺试玩

在查看器点「试玩桥畔茶铺」，也可以[直接进入试玩](https://yinita.github.io/qingming-3d/viewer/?mission)。

- 用 WASD 移动，E 拿放货箱，V 切换第一或第三人称。可以亲自过桥交货，也可以委托伙计。
- 交货后靠近柜台，点「看掌柜斟茶」。浅滩可以涉水和投石，到系船桩可以拉动小船。
- 「查看任务画卷」会以卷面视角呈现当前货箱的位置。
- 栏杆、柜台、树干、货箱和市民会阻挡角色。第三人称镜头接近障碍时会自动收近。

## 来源与许可

- 原画：清院本《清明上河图》，取自 Wikimedia Commons 上标为公有领域的扫描。
- 房屋 3D 模型（`data/seg01/scene/meshes/*.glb`）由 [Hunyuan3D-2](https://github.com/Tencent/Hunyuan3D-2) 生成，受 Tencent Hunyuan Non-Commercial License 约束：仅限非商业使用，且该许可不适用于欧盟、英国和韩国境内。
- 地面补全用 [LaMa](https://github.com/advimman/lama)（Apache-2.0），纸片放大用 [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)（BSD-3-Clause）。
- 查看器代码基于 [three.js](https://threejs.org/)（MIT 许可）。查看器随仓库提供对应版本。
