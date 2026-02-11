# Implementation Plan: SSH Client App

## Overview

基于 Electron + React + TypeScript 的现代化 SSH 客户端桌面应用实现计划。按照从底层服务到上层 UI 的顺序，逐步构建完整功能。

## Tasks

- [x] 1. 项目初始化与基础架构搭建
  - [x] 1.1 初始化 Electron + React + TypeScript + Vite 项目
    - 使用 `electron-vite` 或 `vite` 创建项目骨架
    - 配置 TypeScript、ESLint、Prettier
    - 安装核心依赖：`ssh2`, `xterm`, `xterm-addon-fit`, `xterm-addon-web-links`, `zustand`, `tailwindcss`, `@radix-ui/react-*`, `electron-store`, `uuid`
    - 安装测试依赖：`vitest`, `fast-check`, `@testing-library/react`
    - 配置 Vitest 测试环境
    - _Requirements: 全部_

  - [x] 1.2 搭建 Electron 主进程/渲染进程/Preload 基础结构
    - 创建 `src/main/index.ts` 主进程入口，配置 BrowserWindow 和安全选项（contextIsolation: true, nodeIntegration: false）
    - 创建 `src/preload/index.ts`，通过 `contextBridge.exposeInMainWorld` 暴露 `window.api` 接口
    - 创建 `src/renderer/` React 应用入口
    - 定义 `src/shared/types.ts` 共享类型（HostEntry, SSHSession, FileEntry, TransferProgress, AppConfig 等）
    - _Requirements: 全部_

- [x] 2. 连接管理服务实现
  - [x] 2.1 实现 ConfigStore 配置持久化服务
    - 基于 `electron-store` 实现 `src/main/services/config-store.ts`
    - 实现 getHosts/setHosts、getGroups/setGroups、getAppConfig/setAppConfig 方法
    - _Requirements: 1.6_

  - [x] 2.2 实现 ConnectionManager 连接管理服务
    - 创建 `src/main/services/connection-manager.ts`
    - 实现 createHost、getHost、updateHost、deleteHost、listHosts 方法
    - 实现 createGroup、deleteGroup、listGroups 分组管理方法
    - 实现 HostEntry 验证逻辑（hostname 非空、port 1-65535、username 非空、authMethod 枚举）
    - 实现 exportConfig（序列化为 JSON）和 importConfig（反序列化 + 验证）方法
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2, 7.3, 7.4_

  - [x] 2.3 编写 ConnectionManager 属性测试
    - **Property 1: Host entry create-then-retrieve** — 创建后检索应返回等价对象
    - **Validates: Requirements 1.1, 1.2, 1.6**
    - **Property 2: Host entry update preserves unchanged fields** — 更新后未修改字段保持不变
    - **Validates: Requirements 1.3**
    - **Property 3: Host entry deletion reduces list** — 删除后列表长度减一且不可检索
    - **Validates: Requirements 1.4**
    - **Property 4: Host grouping consistency** — 分组分配后 host 的 group 字段匹配
    - **Validates: Requirements 1.5**
    - **Property 10: Configuration serialization round-trip** — 序列化再反序列化产生等价对象
    - **Validates: Requirements 7.3**
    - **Property 11: Invalid import graceful handling** — 混合有效/无效数据导入正确处理
    - **Validates: Requirements 7.4**

  - [x] 2.4 编写 ConnectionManager 单元测试
    - 测试边界情况：空 hostname、端口 0 和 65536、空 username
    - 测试导入格式错误的 JSON
    - 测试删除不存在的 host
    - _Requirements: 1.1-1.6, 7.1-7.4_

- [x] 3. SSH 服务实现
  - [x] 3.1 实现 SSHService SSH 连接服务
    - 创建 `src/main/services/ssh-service.ts`
    - 基于 `ssh2` 库实现 connect 方法，支持密码和公钥认证
    - 实现 disconnect、getSession、listSessions 会话管理方法
    - 实现 shell 交互：write（发送数据）、resize（调整 PTY 尺寸）
    - 实现 onData/onClose 事件回调注册
    - 实现 keep-alive 心跳机制
    - 实现跳板机（jump host）连接支持
    - 实现连接断开检测和重连逻辑
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.2 编写 SSHService 单元测试
    - 测试会话状态转换逻辑（connecting → connected → disconnected）
    - 测试错误消息生成（认证失败、超时等场景）
    - 测试 keep-alive 配置应用
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

- [x] 4. SFTP 服务实现
  - [x] 4.1 实现 SFTPService 文件传输服务
    - 创建 `src/main/services/sftp-service.ts`
    - 基于 `ssh2` 的 SFTP 子系统实现 listDirectory 方法
    - 实现 upload/download 单文件传输，带进度回调
    - 实现 uploadDirectory/downloadDirectory 递归目录传输
    - 实现传输队列管理（TransferProgress 状态跟踪）
    - 实现 cancelTransfer 取消传输功能
    - 实现文件冲突检测逻辑（检查目标路径是否存在同名文件）
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.6_

  - [x] 4.2 编写 SFTPService 属性测试
    - **Property 6: Transfer progress calculation** — 进度百分比始终在 [0, 100] 范围内
    - **Validates: Requirements 4.5**
    - **Property 7: Transfer queue management** — 所有传输请求都出现在队列中
    - **Validates: Requirements 4.7, 5.5**
    - **Property 8: Recursive directory traversal completeness** — 递归遍历包含所有文件
    - **Validates: Requirements 4.8**
    - **Property 9: File conflict detection** — 正确识别同名文件冲突
    - **Validates: Requirements 5.6**

  - [x] 4.3 编写 SFTPService 单元测试
    - 测试传输状态转换（pending → transferring → completed/failed）
    - 测试取消传输逻辑
    - 测试空目录递归传输
    - _Requirements: 4.5, 4.6, 4.7_

- [x] 5. Checkpoint — 确保所有后端服务测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 6. IPC 通信层实现
  - [x] 6.1 注册主进程 IPC 处理器
    - 创建 `src/main/ipc/index.ts`，注册所有 ipcMain.handle 处理器
    - SSH 相关：`ssh:connect`, `ssh:disconnect`, `ssh:write`, `ssh:resize`
    - SFTP 相关：`sftp:list`, `sftp:upload`, `sftp:download`, `sftp:cancel`
    - Config 相关：`config:getHosts`, `config:saveHost`, `config:deleteHost`, `config:export`, `config:import`, `config:getAppConfig`, `config:setAppConfig`
    - Dialog 相关：`dialog:selectFile`, `dialog:selectSaveLocation`
    - 实现 SSH 数据流的 webContents.send 推送（`ssh:data`, `ssh:close`, `ssh:error`）
    - 实现 SFTP 进度推送（`sftp:progress`）
    - 所有处理器使用 try-catch 包装，错误通过 IPC 返回
    - _Requirements: 全部_

  - [x] 6.2 完善 Preload 脚本 API 暴露
    - 在 `src/preload/index.ts` 中实现完整的 `ElectronAPI` 接口
    - 包装 ipcRenderer.invoke 调用为类型安全的方法
    - 实现事件监听的注册和清理（返回 unsubscribe 函数）
    - _Requirements: 全部_

- [x] 7. 前端状态管理与核心 UI
  - [x] 7.1 实现 Zustand Store
    - 创建 `src/renderer/store/app-store.ts`
    - 实现 hosts/groups/sessions/transfers/UI 状态管理
    - 实现所有 actions：loadHosts、addHost、updateHost、removeHost、connectToHost、disconnectSession 等
    - 通过 `window.api` 调用 IPC 方法
    - _Requirements: 1.1-1.6, 3.2_

  - [x] 7.2 编写 Store 属性测试
    - **Property 5: Session tab tracking** — 标签列表与会话数量一致
    - **Validates: Requirements 3.2**

  - [x] 7.3 实现主布局和主题系统
    - 创建 `src/renderer/App.tsx` 主应用组件
    - 创建 `src/renderer/components/MainLayout.tsx` — 侧边栏 + 主内容区布局
    - 实现 Tailwind CSS 暗色/亮色主题配置和切换逻辑
    - 实现响应式布局，窗口缩放时自适应
    - _Requirements: 6.1, 6.2, 6.4, 6.6_

- [x] 8. 侧边栏与连接管理 UI
  - [x] 8.1 实现侧边栏连接列表组件
    - 创建 `src/renderer/components/Sidebar.tsx`
    - 显示分组树形结构和 Host_Entry 列表
    - 支持侧边栏折叠/展开
    - 实现连接项的右键菜单（编辑、删除、连接）
    - _Requirements: 1.5, 6.2_

  - [x] 8.2 实现连接表单组件
    - 创建 `src/renderer/components/ConnectionForm.tsx`
    - 表单字段：名称、主机名、端口、用户名、认证方式、密钥路径、分组、跳板机、keep-alive
    - 实现表单验证（与后端验证规则一致）
    - 支持新建和编辑模式
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.7_

  - [x] 8.3 实现导入导出对话框
    - 创建 `src/renderer/components/ImportExportDialog.tsx`
    - 导出：调用 config:export，保存为 JSON 文件
    - 导入：选择 JSON 文件，调用 config:import，显示导入结果
    - _Requirements: 7.1, 7.2, 7.4_

- [x] 9. 终端模拟器 UI
  - [x] 9.1 实现终端组件
    - 创建 `src/renderer/components/TerminalView.tsx`
    - 集成 xterm.js，配置 FitAddon 自适应容器尺寸
    - 绑定 SSH 数据流：onData 写入终端、终端输入发送到 SSH
    - 实现终端 resize 事件同步到远程 PTY
    - 支持 ANSI 颜色渲染
    - 支持复制粘贴（Ctrl+Shift+C/V）
    - _Requirements: 3.1, 3.5, 3.6, 3.7_

  - [x] 9.2 实现标签页管理
    - 创建 `src/renderer/components/TabBar.tsx`
    - 显示所有活跃会话标签，支持切换和关闭
    - 切换标签时保持终端实例状态
    - _Requirements: 3.2, 3.3_

  - [x] 9.3 实现终端配置面板
    - 创建 `src/renderer/components/TerminalSettings.tsx`
    - 支持配置字体、字号、颜色主题
    - 实时预览配置变更
    - _Requirements: 3.4_

- [x] 10. 文件浏览器与 SFTP UI
  - [x] 10.1 实现双面板文件浏览器
    - 创建 `src/renderer/components/FileManager.tsx` — 双面板容器
    - 创建 `src/renderer/components/LocalFileBrowser.tsx` — 本地文件树
    - 创建 `src/renderer/components/RemoteFileBrowser.tsx` — 远程文件树
    - 显示文件名、大小、修改时间、权限
    - 支持目录展开/折叠、路径导航
    - _Requirements: 4.1, 4.2_

  - [x] 10.2 实现文件传输操作和进度显示
    - 在文件浏览器中添加上传/下载按钮
    - 创建 `src/renderer/components/TransferQueue.tsx` — 传输队列面板
    - 显示传输进度条、速度、预计剩余时间
    - 支持取消传输和重试失败传输
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 10.3 实现拖拽文件传输
    - 在 LocalFileBrowser 和 RemoteFileBrowser 上实现 drag source 和 drop target
    - 处理面板间拖拽（本地→远程上传，远程→本地下载）
    - 处理系统文件拖入远程面板（使用 HTML5 Drag and Drop API + Electron 原生文件路径）
    - 拖拽过程中显示视觉指示器（高亮目标区域、显示传输方向图标）
    - 多文件拖拽时批量加入传输队列
    - 文件冲突时弹出覆盖/重命名/跳过对话框
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 11. 分屏视图与界面整合
  - [x] 11.1 实现可调节分屏面板
    - 创建 `src/renderer/components/SplitPane.tsx`
    - 支持终端和文件浏览器的水平/垂直分屏
    - 支持拖拽调节分屏比例
    - 支持切换分屏显示/隐藏
    - _Requirements: 6.3_

  - [x] 11.2 整合所有组件和交互流程
    - 将侧边栏、标签页、终端、文件浏览器、传输队列整合到 MainLayout
    - 实现完整的连接流程：选择 Host → 连接 → 打开终端 + 文件浏览器
    - 实现断线重连 UI 流程
    - 添加全局 Toast 通知组件用于错误和状态提示
    - 实现所有交互元素的 hover/active/loading 视觉反馈
    - 添加微动画（面板展开/折叠、主题切换过渡）
    - _Requirements: 6.1, 6.4, 6.5, 6.6, 2.6_

- [x] 12. Final Checkpoint — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## Notes

- 所有任务均为必需任务，包括测试任务
- 每个任务引用了具体的需求编号以确保可追溯性
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- Checkpoint 任务确保增量验证
