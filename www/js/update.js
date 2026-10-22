/* ===== 版本检查与自动更新 =====
 * 清单格式(JSON):
 * { "versionCode": 3, "versionName": "2.1.0", "url": "https://.../app.apk", "notes": "更新内容", "force": false }
 */
(function () {
  const APP_VERSION_CODE = 6;
  const APP_VERSION_NAME = '2.4.0';
  const CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 小时静默检查一次

  async function fetchManifest(url) {
    if (!url) return null;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  const Update = {
    versionCode: APP_VERSION_CODE,
    versionName: APP_VERSION_NAME,

    /** 手动检查:返回 {hasUpdate, manifest} 或抛错 */
    async check() {
      const url = window.DB.settings().updateUrl;
      if (!url) return { hasUpdate: false, noUrl: true };
      const m = await fetchManifest(url);
      window.DB.setMeta('lastVersionCheck', Date.now());
      return { hasUpdate: !!m && (m.versionCode || 0) > APP_VERSION_CODE, manifest: m };
    },

    /** 启动时静默检查(12h 一次),有更新则回调 */
    async silentCheck(onUpdate) {
      const s = window.DB.settings();
      if (!s.autoUpdate || !s.updateUrl) return;
      const last = window.DB.meta().lastVersionCheck || 0;
      if (Date.now() - last < CHECK_INTERVAL) return;
      try {
        const r = await this.check();
        if (r.hasUpdate) onUpdate(r.manifest);
      } catch (e) { /* 静默失败 */ }
    },

    /** 下载并安装:交给系统浏览器/下载器,下载完点安装 */
    install(manifest) {
      if (!manifest || !manifest.url) return;
      window.open(manifest.url, '_system');
      if (window.toast) window.toast('已开始下载,下载完成后点击安装包更新');
    },
  };

  window.Update = Update;
})();
