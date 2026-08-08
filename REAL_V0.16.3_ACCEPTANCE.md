# Real Chrome Acceptance — KV Archive v0.16.3

1. Open a ChatGPT conversation with a distinctive title, for example `VectCutAPI 开源项目分析`.
2. Use the extension popup to download the current conversation as readable HTML.
3. Confirm the downloaded filename begins with the conversation title and ends in `.html`.
4. Repeat with Markdown and technical ZIP; confirm the same title base is used.
5. Test a conversation whose title contains `/ : ? *` or trailing punctuation; confirm download succeeds with a portable sanitized name.
6. Test a newly created or generic-title conversation; confirm the filename is derived from the first user message rather than `ChatGPT.html` or `网页 AI 对话.html`.
7. Export the same conversation twice; confirm Chrome preserves both files by adding its normal duplicate suffix instead of overwriting.

Record the actual filenames. Do not claim real acceptance until the installed extension passes these cases.
