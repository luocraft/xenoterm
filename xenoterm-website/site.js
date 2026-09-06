(async () => {
  try {
    const response = await fetch('/api/release', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('release unavailable');
    const release = await response.json();
    if (!/^\/api\/download\/XenoTerm-Setup-\d+\.\d+\.\d+\.exe$/.test(release.downloadUrl)) throw Error('invalid release');
    document.getElementById('download-link').href = release.downloadUrl;
    document.getElementById('release-meta').textContent = `v${release.version} · Windows 10 / 11 · 64 位 · ${(release.size / 1024 / 1024).toFixed(1)} MB`;
    document.getElementById('release-sha').textContent = release.sha256;
  } catch {
    const error = document.getElementById('release-error');
    error.hidden = false;
    error.textContent = '暂时无法获取版本信息，你仍可尝试下载 v1.7.0。';
    document.getElementById('release-sha').textContent = '暂时无法获取校验值，请稍后刷新。';
  }
})();
