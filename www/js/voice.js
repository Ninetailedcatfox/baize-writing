/* ===== 语音输入模块 v2.1 =====
 * 路线优先级:
 *  A) 输入法语音(默认):聚焦正文 + 原生强制弹出输入法,用户按键盘麦克风说话。
 *     识别由输入法自己完成(搜狗/讯飞走自家云端),不依赖系统语音服务。
 *  B) 系统识别(备用):RecognizerIntent。设备语音服务被停用时不可用。
 *
 * v2.1 关键修复:WebView 里 textarea.focus() 弹不出软键盘,必须调原生
 * InputMethodManager.showSoftInput,否则"输入法语音"是空操作。
 */
(function () {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const nativePlugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechInput;

  let session = null; // { onResult, onEnd, active }

  function focusEditor() {
    const ta = document.getElementById('ed-text');
    if (!ta) return null;
    ta.focus();
    try {
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    } catch (e) {}
    return ta;
  }

  window.Voice = {
    /** 输入法语音:聚焦正文 + 强制弹键盘 + 引导提示 */
    async startIme(onHint) {
      const ta = focusEditor();
      if (!ta) return false;

      const p = nativePlugin();
      if (p && p.showKeyboard) {
        try { await p.showKeyboard(); } catch (e) {}
      }
      // WebView 有时需要延迟再 focus 一次
      setTimeout(() => {
        try { ta.focus(); } catch (e) {}
      }, 120);

      if (onHint) onHint();
      return true;
    },

    /** 探测本机可用方案 */
    async diagnose() {
      const p = nativePlugin();
      if (!p || !p.diagnose) return null;
      try { return await p.diagnose(); } catch (e) { return null; }
    },

    /** 系统识别(备用) */
    async startSystem(onResult, onEnd) {
      if (session && session.active) return;
      const p = nativePlugin();

      if (p) {
        session = { onResult, onEnd, active: true };
        let got = false;
        p.addListener('speechResult', (d) => {
          if (!session || !session.active) return;
          got = true;
          if (d && d.text) onResult(d.text);
          if (session && session.active) {
            setTimeout(() => { if (session && session.active) launch(); }, 350);
          }
        });
        p.addListener('speechError', (d) => {
          if (!session || !session.active) return;
          const code = d && d.code;
          if (code === 'canceled') { this.stopSystem(); return; }
          if (!got) {
            this.stopSystem();
            if (onEnd) onEnd({ error: code || 'unknown' });
          } else {
            setTimeout(() => { if (session && session.active) launch(); }, 600);
          }
        });
        const launch = () => p.start({ lang: 'zh-CN' }).catch(() => {});
        await launch();
        return;
      }

      // Web 降级
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) throw new Error('no-speech-service');
      const rec = new SR();
      rec.lang = 'zh-CN'; rec.continuous = true; rec.interimResults = true;
      session = { onResult, onEnd, active: true, rec };
      rec.onresult = (e) => {
        let t = '';
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
        if (t && session && session.active) onResult(t.trim());
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.stopSystem();
          if (onEnd) onEnd({ error: e.error });
        }
      };
      rec.onend = () => {
        if (session && session.active) { try { rec.start(); } catch (x) {} }
      };
      rec.start();
    },

    stopSystem() {
      if (!session) return;
      const s = session;
      session = null;
      if (s.rec) { try { s.rec.stop(); } catch (e) {} }
      const p = nativePlugin();
      if (p && p.stop) p.stop().catch(() => {});
      if (s.onEnd) s.onEnd({});
    },

    get active() { return !!(session && session.active); },
    get nativeAvailable() { return isNative && !!nativePlugin(); },
    get isNative() { return isNative; },
  };
})();
