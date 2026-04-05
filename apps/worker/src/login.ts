export const LOGIN_HTML = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock Agent — Bejelentkezés</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2'><path d='M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'/></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#eff6ff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
.login-card{background:#fff;border-radius:16px;padding:2.5rem 2rem;width:100%;max-width:380px;box-shadow:0 4px 24px rgba(0,0,0,.08);border:1px solid #e2e8f0}
.login-header{text-align:center;margin-bottom:2rem}
.login-icon{width:56px;height:56px;background:#3b82f6;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;font-size:1.75rem;margin-bottom:1rem}
.login-header h1{font-size:1.35rem;color:#0f172a;margin-bottom:.25rem}
.login-header p{font-size:.85rem;color:#64748b}
.field{margin-bottom:1.25rem}
.field label{display:block;font-size:.8rem;font-weight:600;color:#334155;margin-bottom:.5rem}
.field input{width:100%;padding:.75rem 1rem;border:1px solid #e2e8f0;border-radius:10px;font-size:.9rem;outline:none;transition:border-color .15s,box-shadow .15s}
.field input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
.btn-login{width:100%;padding:.8rem;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-size:.9rem;font-weight:600;cursor:pointer;transition:background .15s}
.btn-login:hover{background:#1d4ed8}
.btn-login:disabled{opacity:.6;cursor:not-allowed}
.error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626;padding:.6rem .75rem;border-radius:8px;font-size:.8rem;margin-bottom:1rem;display:none}
</style>
</head>
<body>
<div class="login-card">
  <div class="login-header">
    <div class="login-icon">📈</div>
    <h1>Stock Agent</h1>
    <p>AI-Powered Portfolio</p>
  </div>
  <div class="error" id="error"></div>
  <form id="login-form" onsubmit="return handleLogin(event)">
    <div class="field">
      <label for="password">Jelszó</label>
      <input type="password" id="password" name="password" placeholder="Jelszó megadása..." autocomplete="current-password" autofocus required>
    </div>
    <button type="submit" class="btn-login" id="btn-login">Belépés</button>
  </form>
</div>
<script>
async function handleLogin(e) {
  e.preventDefault();
  var btn = document.getElementById('btn-login');
  var err = document.getElementById('error');
  var pw = document.getElementById('password').value;
  btn.disabled = true;
  btn.textContent = 'Bejelentkezés...';
  err.style.display = 'none';
  try {
    var r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    var data = await r.json();
    if (r.ok && data.ok) {
      window.location.reload();
    } else {
      err.textContent = data.error || 'Hibás jelszó';
      err.style.display = 'block';
    }
  } catch (ex) {
    err.textContent = 'Hálózati hiba. Próbáld újra.';
    err.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'Belépés';
  return false;
}
</script>
</body>
</html>`;
