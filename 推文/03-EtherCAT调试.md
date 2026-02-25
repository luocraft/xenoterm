# XenoTerm — EtherCAT 从站调试，不用装 TwinCAT 也能玩

调试 EtherCAT 从站，是不是每次都要装一个几 GB 的 TwinCAT？只是想读个 SDO、看看 PDO 数据，杀鸡用牛刀。

XenoTerm 内置了轻量级 EtherCAT 主站功能，基于 SOEM，开箱即用。

## 从站扫描 & 状态控制

选择网卡，一键连接，自动扫描总线上的从站。支持 INIT → PRE-OP → SAFE-OP → OP 状态切换，AL Status Code 中文提示。

【截图：从站列表，显示厂商ID、产品代码、当前状态】

## SDO 读写

对象字典浏览和读写，支持各种数据类型。可以导入 ESI (XML) 文件获取完整的对象字典定义。

【截图：SDO 读写面板，显示 Index/SubIndex/Value】

## PDO 实时监控

启动 PDO 交换后，实时显示输入输出数据。支持信号解析，波形图实时绘制。

【截图：PDO 实时数据和信号波形图】

## FoE 固件升级

通过 File over EtherCAT 协议上传固件到从站，进度条实时显示。

【截图：FoE 上传进度】

## SII (EEPROM) 读写

直接读写从站的 SII 数据，调试从站身份信息时很有用。

【截图：SII 读写面板】

## 谁适合用

- 做伺服驱动器、IO 模块等 EtherCAT 从站开发的工程师
- 需要快速验证从站功能，不想装 TwinCAT 的人
- 产线上做从站配置和固件升级的技术支持

#EtherCAT #工业自动化 #伺服驱动 #嵌入式开发 #XenoTerm
