/* ===== 语音输入模块 v2 =====
 * 两条路线:
 *  A) 输入法语音(默认,最稳):聚焦正文框 + 弹起输入法,用户点键盘上的麦克风键说话。
 *     识别由输入法(搜狗/讯飞/百度)完成,质量最好,无需任何权限。
 *  B) 系统识别(备用):调 Android RecognizerIntent,连续听写。需要设备装了识别服务。
 */
(function () {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const nativePlugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechInput;

  let session = null; // { onResult, onEnd, active }

  function focusEditorAndShowKeyboard() {
    const ta = document.getElementById('ed-text');
    if (!ta) return false;
    ta.focus();
    // 部分 WebView 需要显式触发,再点一次确保光标可见
    setTimeout(() => {
      try {
        ta.click();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      } catch (e) {}
    }, 60);
    return true;
  }

  window.Voice = {
    /** 输入法语音:只负责把键盘叫出来 + 给引导 */
    startIme(onHint) {
      const ok = focusEditorAndShowKeyboard();
      if (ok && onHint) onHint();
      return ok;
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
          // 连续听写:稍后再发一轮
          if (session && session.active) {
            setTimeout(() => { if (session && session.active) launch(); }, 350);
          }
        });
        p.addListener('speechError', (d) => {
          if (!session || !session.active) return;
          const code = d && d.code;
          if (code === 'canceled') { this.stopSystem(); return; }
          // 其他错误:连续模式继续试;首轮就失败则结束
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
