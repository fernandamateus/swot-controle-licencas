(async function () {
  // Se ja existe sessao valida, vai direto para o app.
  try {
    await Api.get('/me');
    window.location.href = '/app.html';
    return;
  } catch { /* nao autenticado, segue para o login */ }

  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      await Api.post('/login', { email, password });
      window.location.href = '/app.html';
    } catch (err) {
      errorBox.textContent = err.message || 'Nao foi possivel entrar.';
      errorBox.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
})();
