# 白泽写作

语音写作 Android App。Capacitor 8 + 系统语音引擎(RecognizerIntent,国产 ROM 底层一般是讯飞)。

## 功能
- 文章管理:列表 / 搜索 / 分组
- 编辑器:自动保存(1.5s 防抖)、字数统计、历史版本快照(5 分钟节流,保留 50 条)
- 语音输入:系统识别引擎,连续听写,文本插入光标处;预留讯飞 SDK 通道
- 导出 TXT / 数据 JSON 搬家
- 夜间模式

## 构建
push 到 main 自动走 GitHub Actions 出 APK(Actions artifact 下载)。

本地开发:`npm i && npx cap sync`,浏览器直接开 `www/index.html` 可调试(web SpeechRecognition 降级)。
