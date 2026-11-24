# 入卷 · 清明上河图（一段）

[进入桥畔茶铺 3D 试玩](https://yinita.github.io/qingming-3d/) · [展开清院本原画](https://yinita.github.io/qingming-3d/viewer/)

- 近景的九座瓦顶由逐片弯曲的灰瓦、椽头和脊瓦构成。门窗有实际进深，人物外袍、斗笠和背箱架可绕着观察。背箱、过桥和靠近柜台时，人物与货箱各有独立的碰撞体。
- 原画视角使用按 30° 斜投影对齐的原画裁片。透视视角的街道使用有体积的角色、车马和树木。
- 远处建筑使用 Hunyuan3D-2 生成的形状和原画纹理，背面和侧面平铺屋顶、墙面样本。
- 画卷地面来自原画和 LaMa 补全。透视街道使用带裂纹和起伏的压实土材质、车辙、嵌入地面的石板与碎石。市民按年龄和衣装区分体形、发际、衣摆和站姿。
- 查看器支持画卷、飞入画中、漫游和俯瞰。画卷使用原画裁片。透视视角使用立体人物、树木、车马与房屋，材质随照明变化。

## 桥畔茶铺试玩

在查看器点「进入任务 · 桥畔茶铺」，也可以[直接进入试玩](https://yinita.github.io/qingming-3d/viewer/?mission)。

- 「任务开始」会保持显示直到取箱或委托伙计。目标标牌显示方向和距离。
- 在任务、漫游或画卷里点「重置任务」，确认后会回到桥头，茶箱归位，并恢复六文铜钱。
- 用 WASD 移动，E 拿放货箱，V 切换第一或第三人称。可以亲自过桥交货，也可以委托伙计。
- 交货后靠近柜台，点「看掌柜斟茶」。浅滩可以涉水和投石，到系船桩可以拉动小船。
- 「查看任务画卷」会以卷面视角呈现当前货箱的位置。
- 栏杆、柜台、树干、货箱和市民会阻挡角色。第三人称镜头接近障碍时会自动收近。

## 来源与许可

- 原画：清院本《清明上河图》，取自 Wikimedia Commons 上标为公有领域的扫描。
- 房屋 3D 模型（`data/seg01/scene/meshes/*.glb`）由 [Hunyuan3D-2](https://github.com/Tencent/Hunyuan3D-2) 生成，受 Tencent Hunyuan Non-Commercial License 约束：仅限非商业使用，且该许可不适用于欧盟、英国和韩国境内。
- 地面补全用 [LaMa](https://github.com/advimman/lama)（Apache-2.0），纸片放大用 [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)（BSD-3-Clause）。
- 查看器代码基于 [three.js](https://threejs.org/)（MIT 许可）。查看器随仓库提供对应版本。
