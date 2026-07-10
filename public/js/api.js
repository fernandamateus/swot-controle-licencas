// Cliente HTTP simples para a API (/api/*). Sempre envia cookies de sessao.
const Api = (() => {
  async function request(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: {},
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/api${path}`, opts);
    let data = null;
    try { data = await res.json(); } catch { /* sem corpo JSON (ex.: download binario) */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erro ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  };
})();

// Converte um File em base64 puro (sem prefixo data:...).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.substring(result.indexOf(',') + 1);
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDateBR(isoDate) {
  if (!isoDate) return '-';
  const s = String(isoDate).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

function nivelLabel(nivel) {
  const map = {
    vencido: 'Vencida',
    critico: 'Crítico (≤15 dias)',
    atencao: 'Atenção (≤30 dias)',
    alerta: 'Renovar (≤ prazo)',
    ok: 'Em dia',
    sem_data: 'Sem validade',
  };
  return map[nivel] || nivel;
}

let toastTimer = null;
function showToast(message, type) {
  let el = document.getElementById('global-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-toast';
    document.body.appendChild(el);
  }
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4200);
}

function showToastLink(message, linkText, linkHref) {
  let el = document.getElementById('global-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-toast';
    document.body.appendChild(el);
  }
  el.className = 'toast success';
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = message + ' ';
  el.appendChild(span);
  const a = document.createElement('a');
  a.href = linkHref;
  a.target = '_blank';
  a.textContent = linkText;
  a.style.cssText = 'color:#fff;font-weight:700;text-decoration:underline;margin-left:6px;';
  el.appendChild(a);
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 7000);
}
