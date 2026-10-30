/**
 * 密钥中转（Keypad Relay）
 *
 * 用途：手表输入法有长度上限，长密钥（如 68 字符的 API Key）打不进去。
 *       这个 Worker 提供一个手机端网页，把密钥暂存几秒，让手表取走。
 *
 * 流程：
 *   1. 手表生成 6 位配对码，显示「打开 <你的域名>/keypad，输入码 xxxx」
 *   2. 手机打开该网址，粘贴密钥，提交
 *   3. 手表轮询 /keypad/get?code=xxxx，取到即存本地
 *   4. 服务端在「被读取」或「超过 10 分钟」后自动删除
 *
 * 隐私：密钥只在 KV 里停留几秒到最长 10 分钟，且只存在你自己部署的这个 Worker 里。
 */

const TTL_SEC = 600;        // KV 条目 10 分钟自动过期
const TTL_MS = TTL_SEC * 1000;
const MAX_KEY_LEN = 512;

function normCode(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

function html(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    // 健康检查（部署完打开看一眼就知道成没成）
    if (request.method === 'GET' && (path === '' || path === '/health')) {
      return json({ ok: true, service: 'keypad-relay', hasKV: !!env.KEYPAD });
    }

    // 手机端：填写页面
    if (request.method === 'GET' && path === '/keypad') {
      return html(page(normCode(url.searchParams.get('code'))));
    }

    // 手机端：提交
    if (request.method === 'POST' && path === '/keypad/set') {
      let body = null;
      try { body = await request.json(); } catch (e) { body = null; }
      const code = normCode(body && body.code);
      const key = String((body && body.key) || '').trim();
      if (code.length !== 6) return json({ ok: false, error: 'bad_code' }, 400);
      if (!key) return json({ ok: false, error: 'no_key' }, 400);
      if (key.length > MAX_KEY_LEN) return json({ ok: false, error: 'key_too_long' }, 400);
      if (!env.KEYPAD) return json({ ok: false, error: 'no_kv_binding' }, 500);
      await env.KEYPAD.put('k:' + code, JSON.stringify({ key: key, ts: Date.now() }), { expirationTtl: TTL_SEC });
      return json({ ok: true });
    }

    // 手表端：轮询取走（读到即删，一次性）
    if (request.method === 'GET' && path === '/keypad/get') {
      const code = normCode(url.searchParams.get('code'));
      if (code.length !== 6) return json({ ok: false, error: 'bad_code' }, 400);
      if (!env.KEYPAD) return json({ ok: false, error: 'no_kv_binding' }, 500);
      const raw = await env.KEYPAD.get('k:' + code);
      if (!raw) return json({ ok: false, error: 'empty' });
      try { await env.KEYPAD.delete('k:' + code); } catch (e) { /* 删不掉也不影响交付 */ }
      let data = {};
      try { data = JSON.parse(raw); } catch (e) { data = {}; }
      const ts = Number(data.ts) || 0;
      if (!ts || Date.now() - ts > TTL_MS) return json({ ok: false, error: 'expired' });
      return json({ ok: true, key: String(data.key || '') });
    }

    return json({ ok: false, error: 'not_found', path: path }, 404);
  },
};

function page(code) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>填写密钥</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; padding:28px 20px 40px; color:#111827; background:#f5f6f8;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  h1 { font-size:20px; margin:0 0 6px; font-weight:600; }
  .sub { color:#6b7280; font-size:14px; margin:0 0 22px; }
  label { display:block; font-size:13px; color:#6b7280; margin:16px 0 6px; }
  input, textarea { width:100%; padding:12px 14px; font-size:16px; font-family:inherit; color:#111827;
                    background:#fff; border:1px solid #dcdfe4; border-radius:10px; outline:none; }
  input:focus, textarea:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.12); }
  #code { letter-spacing:4px; font-weight:600; text-transform:uppercase; }
  textarea { resize:vertical; min-height:88px; line-height:1.45; }
  button { width:100%; margin-top:24px; padding:14px; font-size:16px; font-weight:600; color:#fff;
           background:#2563eb; border:0; border-radius:10px; }
  button:active { background:#1d4ed8; }
  button[disabled] { background:#9ca3af; }
  .msg { margin-top:18px; font-size:14px; line-height:1.5; text-align:center; min-height:22px; }
  .ok { color:#047857; }
  .err { color:#b91c1c; }
  .note { margin-top:26px; padding-top:18px; border-top:1px solid #e3e6ea; color:#9ca3af; font-size:12px; line-height:1.6; }
</style></head>
<body>
  <h1>填写密钥</h1>
  <p class="sub">粘贴密钥，提交后会自动同步到手表</p>
  <form id="f">
    <label for="code">配对码（手表上显示的 6 位）</label>
    <input id="code" value="${code}" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false">
    <label for="key">API 密钥</label>
    <textarea id="key" placeholder="在这里粘贴密钥" autocomplete="off" spellcheck="false"></textarea>
    <button id="btn" type="submit">提交到手表</button>
  </form>
  <div class="msg" id="msg"></div>
  <div class="note">密钥只暂存到你自己的这个中转服务上；手表取走后立即删除，最长不超过 10 分钟。配对码 10 分钟内有效。</div>
<script>
(function () {
  var f = document.getElementById('f'), code = document.getElementById('code'),
      key = document.getElementById('key'), btn = document.getElementById('btn'),
      msg = document.getElementById('msg');
  function say(t, cls) { msg.textContent = t; msg.className = 'msg ' + (cls || ''); }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var c = (code.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var k = (key.value || '').trim();
    if (c.length !== 6) { say('配对码应为 6 位', 'err'); return; }
    if (!k) { say('请先粘贴密钥', 'err'); return; }
    btn.disabled = true;
    say('提交中…');
    fetch('/keypad/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c, key: k })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { say('已发送，回手表看一眼即可', 'ok'); key.value = ''; }
      else { say('提交失败：' + ((j && j.error) || 'unknown'), 'err'); }
    }).catch(function () {
      say('网络失败，请重试', 'err');
    }).then(function () { btn.disabled = false; });
  });
})();
</script>
</body></html>`;
}
