/* ===== AI 扩写 / 续写 =====
 * 走 OpenAI 兼容接口,由用户自带 API Key(设置里填),不依赖任何云端账号。
 * 原生侧 LlmPlugin 负责发请求:WebView 里直接 fetch 会被 CORS 挡掉,
 * 而且原生能边读边把字推回来。
 *
 * 上下文不是只给一句话,而是把「作品大纲 + 角色设定 + 本章上文」一起喂进去,
 * 这样扩写才接得住前文的语感和设定 —— 这是它和普通"润色一下"的区别。
 */
(function () {
  const PROVIDERS = {
    deepseek: { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    moonshot: { name: '月之暗面 Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    zhipu: { name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    silicon: { name: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
    openai: { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    custom: { name: '自定义', base: '', model: '' },
  };

  const DEFAULTS = {
    aiProvider: 'deepseek',
    aiBaseUrl: 'https://api.deepseek.com/v1',
    aiKey: '',
    aiModel: 'deepseek-chat',
    aiTemp: 0.8,
    aiStream: true,
  };

  function settings() {
    const s = window.DB ? window.DB.settings() : {};
    const out = {};
    for (const k in DEFAULTS) out[k] = (s[k] === undefined || s[k] === null || s[k] === '') ? DEFAULTS[k] : s[k];
    return out;
  }

  function setSetting(k, v) {
    window.DB.setSetting(k, v);
  }

  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Llm;

  function hasKey() {
    return !!String(settings().aiKey || '').trim();
  }

  /* ---------------- 提示词组装(纯函数,可单测) ---------------- */

  const SYSTEM_PROMPT = [
    '你是一位资深中文小说作者,擅长把一句话写成一整段有画面感的正文。',
    '严格遵守:',
    '1. 只输出正文,不要任何解释、不要标题、不要 Markdown 标记、不要引号包裹。',
    '2. 紧接【上文】的语言节奏和人称,不要复述上文已经写过的内容。',
    '3. 多写具体的动作、声音、气味、光线和身体感受,少写抽象的总结句。',
    '4. 对话要短,符合人物身份;不要让人物说出作者想说的道理。',
    '5. 不要出现"仿佛""似乎""仿佛在诉说着什么"这类空泛比喻,不要滥用四字成语。',
  ].join('\n');

  /**
   * ctx: { bookName, chapterName, outline, chars[], before, after, instruction, length, mode }
   * mode: 'expand' 扩写 | 'continue' 续写 | 'polish' 润色 | 'describe' 描写
   */
  function buildMessages(ctx) {
    const c = ctx || {};
    const parts = [];

    parts.push('【作品】《' + (c.bookName || '未命名') + '》');
    if (c.chapterName) parts.push('【本章】' + c.chapterName);

    if (c.outline && String(c.outline).trim()) {
      parts.push('【作品大纲】\n' + clipHead(String(c.outline).trim(), 900));
    }
    if (c.chars && c.chars.length) {
      const cs = c.chars.slice(0, 6).map(x => {
        const head = (x.title || '未命名') + ':' + String(x.text || '').replace(/\s+/g, ' ');
        return '- ' + clipHead(head, 160);
      }).join('\n');
      parts.push('【主要角色】\n' + cs);
    }

    if (c.before && String(c.before).trim()) {
      parts.push('【上文】\n' + clip(String(c.before).trim(), 1600));
    }

    const mode = c.mode || 'expand';
    const instr = String(c.instruction || '').trim();
    const len = c.length || 300;

    if (mode === 'polish') {
      parts.push('【任务】把下面的文字润色一遍,保持原意和长度,让语言更准确、更有画面感。');
      if (c.selection) parts.push('【原文】\n' + clip(String(c.selection), 2000));
      if (instr) parts.push('【额外要求】' + instr);
    } else if (mode === 'describe') {
      parts.push('【任务】围绕下面这一点写一段环境或细节描写,约 ' + len + ' 字,要具体、可感。');
      if (instr) parts.push('【要描写的对象】' + instr);
    } else if (mode === 'continue') {
      parts.push('【任务】顺着上文往下写约 ' + len + ' 字正文,情节要往前走,不要停在原地抒情。');
      if (instr) parts.push('【接下来要发生的事】' + instr);
    } else {
      parts.push('【任务】把下面这句话扩写成约 ' + len + ' 字的小说正文。');
      parts.push('【要扩写的内容】' + (instr || '（用户没写具体要求,顺着上文自然推进）'));
      if (c.selection && String(c.selection).trim()) {
        parts.push('【需要被扩写替换的原文片段】\n' + clip(String(c.selection), 1200));
      }
    }

    parts.push('【输出】直接给正文,不要任何前缀说明。');

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') },
    ];
  }

  /* 取结尾 N 字(上文用:越靠后越相关) */
  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length <= n ? s : '…' + s.slice(s.length - n);
  }

  /* 取开头 N 字(大纲/人设用:开头才是设定主干) */
  function clipHead(s, n) {
    s = String(s == null ? '' : s);
    return s.length <= n ? s : s.slice(0, n) + '…';
  }

  /* ---------------- 调用 ---------------- */

  function endpoint(base) {
    let b = String(base || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (/\/chat\/completions$/.test(b)) return b;
    return b + '/chat/completions';
  }

  /**
   * 调一次模型。onDelta 有值且开了流式时边收边回调。
   * 返回 Promise<string>(完整正文)。
   */
  async function callLLM(messages, opts) {
    const o = opts || {};
    const s = settings();
    const url = endpoint(o.baseUrl || s.aiBaseUrl);
    if (!url) throw new Error('还没配置接口地址,去 设置 → AI 扩写 里填一下');
    const key = String(o.apiKey !== undefined ? o.apiKey : s.aiKey).trim();
    if (!key) throw new Error('还没填 API Key,去 设置 → AI 扩写 里填一下');

    const model = o.model || s.aiModel;
    const stream = o.stream === undefined ? !!s.aiStream : !!o.stream;
    const body = {
      model,
      messages,
      temperature: o.temperature === undefined ? Number(s.aiTemp) || 0.8 : o.temperature,
      stream,
      max_tokens: o.maxTokens || 1600,
    };

    const onDelta = o.onDelta;
    const p = plugin();

    // 真机上没有原生模块时,走 fetch 会被 CORS 挡掉,报错很难看懂 —— 这里直接给准话
    if (isNative() && !(p && p.chat)) {
      throw new Error('当前 App 版本没有 AI 模块,更新到最新版再用');
    }

    if (p && p.chat) {
      let handle = null;
      if (stream && onDelta) {
        try {
          handle = await p.addListener('chunk', ev => {
            if (ev && ev.text) onDelta(ev.text);
          });
        } catch (e) { }
      }
      try {
        const r = await p.chat({ url, apiKey: key, body: JSON.stringify(body), stream });
        return clean(r && r.text ? r.text : '');
      } finally {
        if (handle && handle.remove) { try { await handle.remove(); } catch (e) { } }
      }
    }

    // 浏览器/测试环境兜底
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(Object.assign({}, body, { stream: false })),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' · ' + t.slice(0, 200));
    }
    const j = await res.json();
    const txt = j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    return clean(txt || '');
  }

  /** 清掉模型偶尔带出来的 markdown 包装和"好的,以下是…"这类开场 */
  function clean(t) {
    let s = String(t == null ? '' : t).replace(/\r\n?/g, '\n');
    s = s.replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
    s = s.replace(/^\s*(好的|当然|没问题)[,，。:：].{0,30}?\n+/, '');
    s = s.replace(/^\s*(以下是|下面是)[^\n]{0,40}\n+/, '');
    return s.trim();
  }

  /** 取最近 N 字作为上文 */
  function tail(text, n) {
    const t = String(text || '');
    return t.length <= n ? t : t.slice(t.length - n);
  }

  window.AI = {
    PROVIDERS, DEFAULTS, settings, setSetting, hasKey,
    buildMessages, callLLM, clean, tail, endpoint,
    /** 给 UI 用的高层入口 */
    async generate(ctx, onDelta) {
      const msgs = buildMessages(ctx);
      return callLLM(msgs, { onDelta });
    },
  };
})();
