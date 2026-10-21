/* ===== 语音输入模块 =====
 * 三级通道:
 * 1. 原生插件 SpeechInput(Capacitor,RecognizerIntent,国产 ROM 底层一般是讯飞)
 * 2. 讯飞 SDK 预留:原生插件侧若注册了 XfSpeech 通道则优先(见 Android 插件)
 * 3. Web 降级:webkitSpeechRecognition(浏览器调试用)
 */
(function () {
  let listening = false;
  let autoChain = false; // 连续听写:一次识别结束自动再发起
  let onResultCb = null, onEndCb = null;

  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  function nativePlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechInput;
  }

  async function startNative() {
    const p = nativePlugin();
    if (!p) throw new Error('native plugin missing');
    let resolved = false;
    p.addListener('speechResult', (data) => {
      resolved = true;
      if (data && data.text && onResultCb) onResultCb(data.text);
      if (listening && autoChain) {
        // 连续模式:0.4s 后自动再听
        setTimeout(() => { if (listening && autoChain) startNative().catch(stopInternal); }, 400);
      } else {
        stopInternal(true);
      }
    });
    p.addListener('speechError', (data) => {
      console.warn('[voice] native error', data && data.code);
      if (!resolved && listening) {
        if (autoChain) {
          setTimeout(() => { if (listening && autoChain) startNative().catch(stopInternal); }, 600);
        } else {
          stopInternal(true);
        }
      }
    });
    await p.start({ lang: 'zh-CN', continuous: true });
  }

  function startWeb() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('此环境不支持语音识别');
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      if (finalText && onResultCb) onResultCb(finalText.trim());
    };
    rec.onerror = (e) => {
      console.warn('[voice] web error', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopInternal(true);
    };
    rec.onend = () => {
      if (listening && autoChain) { try { rec.start(); } catch (_) {} }
      else stopInternal(true);
    };
    rec.start();
    webRec = rec;
  }

  let webRec = null;

  function stopInternal(silent) {
    listening = false; autoChain = false;
    if (webRec) { try { webRec.stop(); } catch (_) {} webRec = null; }
    if (onEndCb && !silent) onEndCb();
    else if (onEndCb) onEndCb();
  }

  window.Voice = {
    get isSupported() {
      return isNative ? !!nativePlugin() : !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    /* onResult(text) 新识别到一段文本;onEnd() 整个听写会话结束 */
    async start(onResult, onEnd) {
      if (listening) return;
      onResultCb = onResult; onEndCb = onEnd;
      listening = true; autoChain = true;
      try {
        if (isNative) await startNative(); else startWeb();
      } catch (e) {
        listening = false; autoChain = false;
        throw e;
      }
    },
    stop() {
      if (!listening) return;
      // 原生会话:让 chain 停掉即可;正在识别的最后一轮返回后不再续
      autoChain = false;
      const p = nativePlugin();
      if (p && p.stop) p.stop().catch(() => {});
      if (webRec) { try { webRec.stop(); } catch (_) {} }
      // Web 模式 onend 会回调;原生模式直接结束
      if (!isNative) { /* wait for onend */ }
      else {
        listening = false;
        if (onEndCb) onEndCb();
      }
    },
    get listening() { return listening; },
  };
})();
