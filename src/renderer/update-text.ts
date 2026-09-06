import type { Locale } from './i18n';

const updateTexts = {
  zh: {
    title: '应用更新',
    openDialog: '检查更新',
    currentVersion: '当前版本',
    availableVersion: '最新版本',
    autoCheck: '启动时自动检查',
    checkNow: '检查更新',
    installNow: '立即安装',
    progress: '下载进度',
    status: {
      idle: '可以开始检查更新',
      checking: '正在检查更新...',
      available: '发现新版本，正在后台下载',
      notAvailable: '当前已经是最新版本',
      downloading: '正在下载更新...',
      downloaded: '更新已下载完成，可以安装',
      error: '检查更新失败',
      disabled: '当前构建不支持自动更新'
    },
    toast: {
      available: '发现新版本 {version}，正在后台下载。',
      none: '当前已经是最新版本。',
      error: '暂时无法检查更新。'
    }
  },
  en: {
    title: 'App Update',
    openDialog: 'Check updates',
    currentVersion: 'Current version',
    availableVersion: 'Latest version',
    autoCheck: 'Check on startup',
    checkNow: 'Check for updates',
    installNow: 'Install now',
    progress: 'Download progress',
    status: {
      idle: 'Ready to check for updates',
      checking: 'Checking for updates...',
      available: 'Update found, downloading in the background',
      notAvailable: 'You are already on the latest version',
      downloading: 'Downloading update...',
      downloaded: 'Update downloaded, ready to install',
      error: 'Update check failed',
      disabled: 'Auto update is unavailable in this build'
    },
    toast: {
      available: 'New version {version} found. Downloading in the background.',
      none: 'You are already on the latest version.',
      error: 'Unable to check for updates.'
    }
  }
} as const;

export function getUpdateText(locale: Locale) {
  return updateTexts[locale];
}
