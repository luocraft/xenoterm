# XenoTerm

一个基于 Electron + React 构建的现代化 SSH 客户端桌面应用。

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

## 功能特性

- **SSH 终端连接** — 支持密码和密钥两种认证方式，基于 xterm.js 的终端模拟器
- **SFTP 文件管理** — 远程文件浏览、上传、下载，支持传输进度显示和取消
- **本地文件浏览** — 内置本地文件浏览器，方便拖拽上传
- **终端分屏** — 支持拖拽分屏布局，多终端并排操作
- **连接管理** — 保存、编辑、删除连接配置，支持分组管理
- **导入/导出** — 连接配置的导入导出，方便迁移
- **命令历史** — 记录终端命令历史，快速回溯
- **主题切换** — 支持深色/浅色主题
- **自定义窗口** — 无边框窗口，自定义标题栏

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron 28 + electron-vite |
| 前端 | React 18 + TypeScript |
| 样式 | Tailwind CSS + Radix UI |
| 状态管理 | Zustand |
| 终端 | xterm.js |
| SSH/SFTP | ssh2 |
| 测试 | Vitest + fast-check |

## 项目结构

```
src/
├── main/              # Electron 主进程
│   ├── index.ts       # 应用入口，窗口创建
│   ├── ipc/           # IPC 通信处理
│   └── services/      # SSH、SFTP、配置管理等核心服务
├── preload/           # 预加载脚本（contextBridge）
├── renderer/          # React 渲染进程
│   ├── components/    # UI 组件
│   ├── store/         # Zustand 状态管理
│   └── styles/        # 全局样式
└── shared/            # 主进程与渲染进程共享类型
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
# 构建产物
npm run build

# 打包 Windows 安装包
npm run dist
```

### 测试

```bash
npm test
```

## 许可证

MIT
