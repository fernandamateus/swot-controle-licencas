(function () {
  const state = {
    user: null,
    clients: [],
    clientsById: {},
    licenses: [],
    currentClientId: null,
    pendingDocument: null, // { base64, mediaType, filename }
    pendingFile: null,
    pendingFileURL: null,
    editingLicenseId: null,
    editingClientId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const openModal = (id) => document.getElementById(id).classList.add('active');
  const closeModal = (id) => document.getElementById(id).classList.remove('active');

  // ===================================================================
  // BOOT
  // ===================================================================
  async function boot() {
    try {
      const meRes = await Api.get('/me');
      state.user = meRes.user;
    } catch {
      window.location.href = '/index.html';
      return;
    }

    $('#user-name').textContent = state.user.name;
    $('#user-role').textContent = state.user.role === 'admin_master' ? 'Admin master' : 'Usuário';
    if (state.user.role === 'admin_master') {
      $('#nav-usuarios').style.display = 'block';
      $('#btn-nova-legislacao').style.display = 'inline-block';
    }

    setupNav();
    setupGlobalHandlers();

    if (state.user.mustChangePassword) {
      openForcedChangePassword();
    } else {
      checkLegislationBanner();
    }

    await loadClients();
    switchView('dashboard');
  }

  function setupNav() {
    $$('#nav button').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }

  function switchView(name) {
    $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');

    if (name === 'dashboard') loadDashboard();
    else if (name === 'clientes') loadClientesView();
    else if (name === 'licencas') loadLicencasView();
    else if (name === 'emails') loadEmailLog();
    else if (name === 'legislacao') loadLegislacaoView();
    else if (name === 'usuarios') loadUsuariosView();
  }

  // ===================================================================
  // HELPERS GERAIS
  // ===================================================================
  async function loadClients() {
    const { clients } = await Api.get('/clients');
    state.clients = clients;
    state.clientsById = {};
    clients.forEach((c) => { state.clientsById[c.id] = c; });
  }

  async function loadLicenses() {
    const { licenses } = await Api.get('/licenses');
    state.licenses = licenses;
  }

  function filterLicenses(rows, search, nivel) {
    let result = rows;
    if (nivel) result = result.filter((r) => r.nivel === nivel);
    if (search) {
      const needle = search.toLowerCase();
      result = result.filter((r) =>
        (r.descricao || '').toLowerCase().includes(needle) ||
        (r.numero || '').toLowerCase().includes(needle) ||
        (r.cliente_nome || '').toLowerCase().includes(needle)
      );
    }
    return result;
  }

  function renderLicenseTable(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="empty-state">Nenhuma licença encontrada.</div>';
    const head = `
      <table>
        <thead><tr>
          ${opts.hideCliente ? '' : '<th>Cliente</th>'}
          <th>CNPJ</th>
          <th>Descrição</th><th>Número</th><th>Órgão</th><th>Validade</th><th>Situação</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              ${opts.hideCliente ? '' : `<td>${escapeHtml(r.cliente_nome || '')}</td>`}
              <td>${r.licenca_cnpj ? `${r.licenca_cnpj_apelido ? escapeHtml(r.licenca_cnpj_apelido) + '<br>' : ''}<span class="muted">${escapeHtml(r.licenca_cnpj)}</span>` : '-'}</td>
              <td>${escapeHtml(r.descricao || '')}</td>
              <td>${escapeHtml(r.numero || '-')}</td>
              <td>${escapeHtml(r.orgao_expeditor || '-')}</td>
              <td>${formatDateBR(r.validade)}${r.diasParaVencer !== null && r.diasParaVencer !== undefined ? `<br><span class="muted">${r.diasParaVencer >= 0 ? r.diasParaVencer + ' dias' : Math.abs(r.diasParaVencer) + ' dias atrás'}</span>` : ''}</td>
              <td><span class="badge ${r.nivel}">${nivelLabel(r.nivel)}</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn-secondary btn-sm" data-action="edit-licenca" data-id="${r.id}">Editar</button>
                  <button class="btn-secondary btn-sm" data-action="email-licenca" data-id="${r.id}">E-mail</button>
                  ${r.documento_nome ? `<a class="btn-secondary btn-sm" href="/api/licenses/${r.id}/document" target="_blank" title="${escapeHtml(r.documento_nome)}">📄 Visualizar</a>` : ''}
                  <button class="btn-danger btn-sm" data-action="delete-licenca" data-id="${r.id}">Excluir</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
    return head;
  }

  function bindLicenseTableActions(container) {
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const action = btn.dataset.action;
      if (action === 'edit-licenca') openLicenseModal(id);
      else if (action === 'email-licenca') openEmailModal(id);
      else if (action === 'delete-licenca') {
        if (!confirm('Excluir esta licença? Esta ação não pode ser desfeita.')) return;
        try {
          await Api.del(`/licenses/${id}`);
          showToast('Licença excluída.', 'success');
          await loadLicenses();
          refreshCurrentView();
        } catch (err) { showToast(err.message, 'error'); }
      }
    });
  }

  function refreshCurrentView() {
    const active = $('#nav button.active');
    if (active) switchView(active.dataset.view);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ===================================================================
  // DASHBOARD
  // ===================================================================
  async function loadDashboard() {
    await loadLicenses();
    renderDashCards();
    renderDashTable();
  }

  function renderDashCards() {
    const counts = { vencido: 0, critico: 0, atencao: 0, alerta: 0, ok: 0 };
    state.licenses.forEach((r) => { if (counts[r.nivel] !== undefined) counts[r.nivel]++; });
    $('#dash-cards').innerHTML = `
      <div class="card-stat vencido"><div class="num">${counts.vencido}</div><div class="label">Vencidas</div></div>
      <div class="card-stat critico"><div class="num">${counts.critico}</div><div class="label">Críticas (≤15d)</div></div>
      <div class="card-stat atencao"><div class="num">${counts.atencao}</div><div class="label">Atenção (≤30d)</div></div>
      <div class="card-stat alerta"><div class="num">${counts.alerta}</div><div class="label">Renovar</div></div>
      <div class="card-stat total"><div class="num">${state.licenses.length}</div><div class="label">Total de licenças</div></div>
    `;
  }

  function renderDashTable() {
    const search = $('#dash-search').value.trim();
    const nivel = $('#dash-filtro-nivel').value;
    const rows = filterLicenses(state.licenses, search, nivel);
    const wrap = $('#dash-table-wrap');
    wrap.innerHTML = renderLicenseTable(rows);
    bindLicenseTableActions(wrap);
  }

  // ===================================================================
  // CLIENTES
  // ===================================================================
  async function loadClientesView() {
    await loadClients();
    renderClientesTable();
    $('#cliente-detalhe-panel').style.display = 'none';
    $('#clientes-list-panel').style.display = 'block';
  }

  function renderClientesTable() {
    const search = $('#clientes-search').value.trim().toLowerCase();
    const rows = search
      ? state.clients.filter((c) => (c.name || '').toLowerCase().includes(search) || (c.cnpj || '').toLowerCase().includes(search))
      : state.clients;
    const wrap = $('#clientes-table-wrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty-state">Nenhum cliente encontrado.</div>';
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Nome</th><th>CNPJ</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows.map((c) => `
            <tr>
              <td><a href="#" data-action="abrir-cliente" data-id="${c.id}">${escapeHtml(c.name)}</a></td>
              <td>${escapeHtml(c.cnpj || '-')}</td>
              <td><span class="badge ${c.status === 'ativo' ? 'ok' : 'sem_data'}">${c.status}</span></td>
              <td><button class="btn-secondary btn-sm" data-action="abrir-cliente" data-id="${c.id}">Abrir</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
    wrap.querySelectorAll('[data-action="abrir-cliente"]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); openClientDetail(Number(el.dataset.id)); });
    });
  }

  async function openClientDetail(clientId) {
    state.currentClientId = clientId;
    const data = await Api.get(`/clients/${clientId}`);
    $('#clientes-list-panel').style.display = 'none';
    const panel = $('#cliente-detalhe-panel');
    panel.style.display = 'block';
    $('#cliente-detalhe-titulo').textContent = data.client.name;

    const licRows = data.licenses.map((r) => ({ ...r, ...computeAlertClient(r) }));
    const requiredTags = data.requiredLicenses.map((rl) => `<span class="tag">${escapeHtml(rl.tipo)} <button data-action="del-req" data-id="${rl.id}" style="border:none;background:none;color:#c4302b;cursor:pointer;font-weight:700;">×</button></span>`).join(' ');
    const cnpjRows = (data.cnpjs || []).map((cn) => `
      <tr>
        <td>${escapeHtml(cn.apelido || '-')}</td>
        <td>${escapeHtml(cn.cnpj)}</td>
        <td><button class="btn-danger btn-sm" data-action="del-cnpj" data-id="${cn.id}">Remover</button></td>
      </tr>`).join('');
    const contactsRows = data.contacts.map((ct) => `
      <tr>
        <td>${escapeHtml(ct.nome || '-')}</td>
        <td>${escapeHtml(ct.email)}</td>
        <td>${ct.receber_alertas ? '<span class="badge ok">Sim</span>' : '<span class="badge sem_data">Não</span>'}</td>
        <td><button class="btn-danger btn-sm" data-action="del-contato" data-id="${ct.id}">Remover</button></td>
      </tr>`).join('');

    $('#cliente-detalhe-conteudo').innerHTML = `
      <p class="muted">CNPJ: ${escapeHtml(data.client.cnpj || '-')} · Status: ${escapeHtml(data.client.status)}</p>
      ${data.client.notes ? `<p>${escapeHtml(data.client.notes)}</p>` : ''}

      <hr class="sep" />
      <div class="panel-head"><h3>Licenças exigidas</h3><button class="btn-secondary btn-sm" data-action="add-req">+ Adicionar</button></div>
      <div class="tag-list">${requiredTags || '<span class="muted">Nenhuma licença obrigatória cadastrada.</span>'}</div>

      <hr class="sep" />
      <div class="panel-head"><h3>CNPJs do cliente</h3><button class="btn-secondary btn-sm" data-action="add-cnpj">+ Adicionar CNPJ</button></div>
      ${(data.cnpjs || []).length ? `<table><thead><tr><th>Identificação</th><th>CNPJ</th><th></th></tr></thead><tbody>${cnpjRows}</tbody></table>` : '<p class="muted">Nenhum CNPJ adicional cadastrado. Cadastre aqui os CNPJs deste cliente para poder vinculá-los às licenças.</p>'}

      <hr class="sep" />
      <div class="panel-head"><h3>Contatos de e-mail</h3><button class="btn-secondary btn-sm" data-action="add-contato">+ Adicionar</button></div>
      ${data.contacts.length ? `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Recebe alertas</th><th></th></tr></thead><tbody>${contactsRows}</tbody></table>` : '<p class="muted">Nenhum contato cadastrado.</p>'}

      <hr class="sep" />
      <div class="panel-head"><h3>Licenças do cliente</h3></div>
      <div id="cliente-licencas-wrap">${renderLicenseTable(licRows, { hideCliente: true })}</div>
    `;
    bindLicenseTableActions($('#cliente-licencas-wrap'));

    $('#cliente-detalhe-conteudo').querySelectorAll('[data-action="del-contato"]').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!confirm('Remover este contato?')) return;
        await Api.del(`/clients/${clientId}/contacts/${el.dataset.id}`);
        openClientDetail(clientId);
      });
    });
    $('#cliente-detalhe-conteudo').querySelectorAll('[data-action="del-req"]').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!confirm('Remover esta licença exigida?')) return;
        await Api.del(`/clients/${clientId}/required-licenses/${el.dataset.id}`);
        openClientDetail(clientId);
      });
    });
    const addReqBtn = $('#cliente-detalhe-conteudo').querySelector('[data-action="add-req"]');
    if (addReqBtn) addReqBtn.addEventListener('click', async () => {
      const tipo = prompt('Tipo de licença exigida (ex.: IBAMA - CTF, Corpo de Bombeiros, etc.):');
      if (!tipo) return;
      await Api.post(`/clients/${clientId}/required-licenses`, { tipo });
      openClientDetail(clientId);
    });
    $('#cliente-detalhe-conteudo').querySelectorAll('[data-action="del-cnpj"]').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!confirm('Remover este CNPJ? Licenças vinculadas a ele ficarão sem CNPJ específico.')) return;
        await Api.del(`/clients/${clientId}/cnpjs/${el.dataset.id}`);
        showToast('CNPJ removido.', 'success');
        openClientDetail(clientId);
      });
    });
    const addCnpjBtn = $('#cliente-detalhe-conteudo').querySelector('[data-action="add-cnpj"]');
    if (addCnpjBtn) addCnpjBtn.addEventListener('click', () => openCnpjModal(clientId));
    const addContatoBtn = $('#cliente-detalhe-conteudo').querySelector('[data-action="add-contato"]');
    if (addContatoBtn) addContatoBtn.addEventListener('click', () => openContatoModal(clientId));
  }

  function openCnpjModal(clientId) {
    state.currentClientId = clientId;
    $('#cnpj-valor').value = '';
    $('#cnpj-apelido').value = '';
    openModal('modal-cnpj');
  }

  function computeAlertClient(r) { return { nivel: r.nivel, diasParaVencer: r.diasParaVencer }; }

  function openClientModal(client) {
    state.editingClientId = client ? client.id : null;
    $('#modal-cliente-titulo').textContent = client ? 'Editar cliente' : 'Novo cliente';
    $('#cli-id').value = client ? client.id : '';
    $('#cli-nome').value = client ? client.name : '';
    $('#cli-cnpj').value = client ? (client.cnpj || '') : '';
    $('#cli-status').value = client ? client.status : 'ativo';
    $('#cli-obs').value = client ? (client.notes || '') : '';
    openModal('modal-cliente');
  }

  function openContatoModal(clientId) {
    state.currentClientId = clientId;
    $('#contato-nome').value = '';
    $('#contato-email').value = '';
    $('#contato-receber').checked = true;
    openModal('modal-contato');
  }

  // ===================================================================
  // LICENÇAS (view de listagem geral)
  // ===================================================================
  async function loadLicencasView() {
    await Promise.all([loadClients(), loadLicenses()]);
    fillClienteSelect();
    renderLicTable();
  }

  function fillClienteSelect() {
    const sel = $('#lic-cliente');
    sel.innerHTML = '<option value="">Selecione...</option>' +
      state.clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  function renderLicTable() {
    const search = $('#lic-search').value.trim();
    const rows = filterLicenses(state.licenses, search, '');
    const wrap = $('#lic-table-wrap');
    wrap.innerHTML = renderLicenseTable(rows);
    bindLicenseTableActions(wrap);
  }

  async function updateLicCnpjOptions(clientId, selectedCnpjId) {
    const sel = $('#lic-cnpj');
    if (!clientId) {
      sel.innerHTML = '<option value="">Selecione o cliente primeiro</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">Carregando...</option>';
    try {
      const data = await Api.get(`/clients/${clientId}`);
      state.cnpjsByClient = state.cnpjsByClient || {};
      state.cnpjsByClient[clientId] = data.cnpjs || [];
      if (!state.cnpjsByClient[clientId].length) {
        sel.innerHTML = '<option value="">Nenhum CNPJ cadastrado para este cliente</option>';
        return;
      }
      sel.innerHTML = '<option value="">Não especificar</option>' +
        state.cnpjsByClient[clientId].map((cn) => `<option value="${cn.id}">${cn.apelido ? escapeHtml(cn.apelido) + ' — ' : ''}${escapeHtml(cn.cnpj)}</option>`).join('');
      if (selectedCnpjId) sel.value = selectedCnpjId;
    } catch {
      sel.innerHTML = '<option value="">Erro ao carregar CNPJs</option>';
    }
  }

  async function openLicenseModal(licenseId) {
    state.editingLicenseId = licenseId || null;
    state.pendingDocument = null;
    state.pendingFile = null;
    if (state.pendingFileURL) { URL.revokeObjectURL(state.pendingFileURL); state.pendingFileURL = null; }
    $('#lic-upload-status').textContent = '';
    $('#lic-upload-drop').style.display = '';
    $('#lic-file-actions').style.display = 'none';
    $('#lic-file-name').textContent = '';
    $('#lic-file-input').value = '';
    $('#form-licenca').reset();
    $('#lic-error').style.display = 'none';
    fillClienteSelect();

    if (licenseId) {
      const lic = state.licenses.find((l) => l.id === licenseId);
      $('#modal-licenca-titulo').textContent = 'Editar licença';
      $('#lic-id').value = lic.id;
      $('#lic-cliente').value = lic.client_id;
      $('#lic-classe').value = lic.classe || '';
      $('#lic-unidade').value = lic.unidade || '';
      $('#lic-descricao').value = lic.descricao || '';
      $('#lic-numero').value = lic.numero || '';
      $('#lic-orgao').value = lic.orgao_expeditor || '';
      $('#lic-emissao').value = (lic.emissao || '').slice(0, 10);
      $('#lic-validade').value = (lic.validade || '').slice(0, 10);
      $('#lic-responsavel').value = lic.responsavel || '';
      $('#lic-lead').value = lic.renovacao_lead_days || 60;
      $('#lic-info').value = lic.info_adicional || '';
      $('#lic-auto-aviso').checked = !!lic.auto_enviar_aviso;
      await updateLicCnpjOptions(lic.client_id, lic.cnpj_id);
    } else {
      $('#modal-licenca-titulo').textContent = 'Cadastrar licença';
      $('#lic-id').value = '';
      $('#lic-lead').value = 60;
      await updateLicCnpjOptions('');
    }
    openModal('modal-licenca');
  }

  async function handleLicenseFileSelected(file) {
    const mediaMap = { 'application/pdf': 'application/pdf', 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp' };
    const mediaType = mediaMap[file.type];
    if (!mediaType) {
      showToast('Formato não suportado. Envie PDF, PNG, JPG ou WEBP.', 'error');
      return;
    }
    const base64 = await fileToBase64(file);
    state.pendingDocument = { base64, mediaType, filename: file.name };
    state.pendingFile = file;

    // Guarda URL para pré-visualização
    if (state.pendingFileURL) URL.revokeObjectURL(state.pendingFileURL);
    state.pendingFileURL = URL.createObjectURL(file);

    // Mostra botões de ação
    $('#lic-upload-drop').style.display = 'none';
    $('#lic-file-name').textContent = `📄 ${file.name}`;
    $('#lic-file-actions').style.display = 'block';
    $('#lic-upload-status').textContent = '';

    // Ler campos grátis: só funciona para PDF
    if (mediaType !== 'application/pdf') {
      $('#btn-ler-campos').disabled = true;
      $('#btn-ler-campos').title = 'Leitura automática disponível apenas para PDF';
    } else {
      $('#btn-ler-campos').disabled = false;
      $('#btn-ler-campos').title = '';
    }
  }

  function attachFileOnly() {
    // Apenas registra o documento — campos preenchidos manualmente
    const nome = state.pendingDocument.filename;
    $('#lic-upload-status').innerHTML = `✅ Arquivo "<strong>${escapeHtml(nome)}</strong>" pronto para salvar. Preencha os campos abaixo.`;
    $('#lic-file-actions').style.display = 'none';
    // Mantém o botão de preview visível separadamente
    if (state.pendingFileURL) {
      const link = document.createElement('a');
      link.href = state.pendingFileURL;
      link.target = '_blank';
      link.className = 'btn-secondary btn-sm';
      link.textContent = '👁 Pré-visualizar';
      link.style.marginLeft = '8px';
      $('#lic-upload-status').appendChild(link);
    }
  }

  function previewArquivoSelecionado() {
    if (state.pendingFileURL) window.open(state.pendingFileURL, '_blank');
  }

  async function extractDocumentFree() {
    if (!state.pendingDocument) return;
    const { base64, mediaType, filename } = state.pendingDocument;
    $('#lic-upload-status').textContent = '🔍 Lendo campos do documento, aguarde...';
    $('#lic-file-actions').style.display = 'none';
    try {
      const { extracted } = await Api.post('/extract-document', { base64, mediaType, filename });
      await applyExtractedFields(extracted);
      $('#lic-upload-status').textContent = `✅ Campos lidos de "${filename}". Confira e ajuste antes de salvar.`;
    } catch (err) {
      $('#lic-file-actions').style.display = 'block';
      $('#lic-upload-status').textContent = '';
      showToast('Não foi possível ler os campos: ' + err.message, 'error');
    }
  }

  async function applyExtractedFields(extracted) {
    if (!extracted) return;
    if (extracted.classe) $('#lic-classe').value = extracted.classe;
    if (extracted.descricao) $('#lic-descricao').value = extracted.descricao;
    if (extracted.numero) $('#lic-numero').value = extracted.numero;
    if (extracted.orgao_expeditor) $('#lic-orgao').value = extracted.orgao_expeditor;
    if (extracted.emissao) $('#lic-emissao').value = extracted.emissao;
    if (extracted.validade) $('#lic-validade').value = extracted.validade;
    if (extracted.observacoes) $('#lic-info').value = extracted.observacoes;

    let matchedClientId = null;
    if (extracted.cliente_nome) {
      const needle = extracted.cliente_nome.toLowerCase();
      const match = state.clients.find((c) => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()));
      if (match) {
        $('#lic-cliente').value = match.id;
        matchedClientId = match.id;
      } else {
        showToast(`IA identificou o cliente "${extracted.cliente_nome}", mas ele não foi encontrado na lista. Selecione manualmente.`, '');
      }
    }
    if (!matchedClientId) matchedClientId = $('#lic-cliente').value || null;

    if (matchedClientId) {
      await updateLicCnpjOptions(matchedClientId);
      if (extracted.cliente_cnpj) {
        const digits = String(extracted.cliente_cnpj).replace(/\D/g, '');
        const cnpjs = (state.cnpjsByClient && state.cnpjsByClient[matchedClientId]) || [];
        const cnpjMatch = cnpjs.find((cn) => cn.cnpj.replace(/\D/g, '') === digits);
        if (cnpjMatch) $('#lic-cnpj').value = cnpjMatch.id;
      }
    }
  }

  async function submitLicenseForm(e) {
    e.preventDefault();
    $('#lic-error').style.display = 'none';
    const clientId = $('#lic-cliente').value;
    if (!clientId) { showLicError('Selecione o cliente.'); return; }
    const descricao = $('#lic-descricao').value.trim();
    if (!descricao) { showLicError('Informe a descrição do documento.'); return; }

    const body = {
      clientId: Number(clientId),
      cnpjId: $('#lic-cnpj').value ? Number($('#lic-cnpj').value) : null,
      classe: $('#lic-classe').value || null,
      unidade: $('#lic-unidade').value || null,
      descricao,
      numero: $('#lic-numero').value || null,
      orgaoExpeditor: $('#lic-orgao').value || null,
      responsavel: $('#lic-responsavel').value || null,
      emissao: $('#lic-emissao').value || null,
      validade: $('#lic-validade').value || null,
      renovacaoLeadDays: Number($('#lic-lead').value) || 60,
      infoAdicional: $('#lic-info').value || null,
      autoEnviarAviso: $('#lic-auto-aviso').checked,
    };
    if (state.pendingDocument) {
      body.documentoBase64 = state.pendingDocument.base64;
      body.documentoNomeOriginal = state.pendingDocument.filename;
    }

    const btn = $('#btn-licenca-salvar');
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    try {
      let savedLicense;
      if (state.editingLicenseId) {
        const res = await Api.put(`/licenses/${state.editingLicenseId}`, body);
        savedLicense = res.license;
      } else {
        const res = await Api.post('/licenses', body);
        savedLicense = res.license;
      }
      closeModal('modal-licenca');
      if (state.pendingFileURL) { URL.revokeObjectURL(state.pendingFileURL); state.pendingFileURL = null; }
      await loadLicenses();
      refreshCurrentView();
      // Toast com link de visualização se tiver documento
      if (savedLicense && savedLicense.documento_nome) {
        showToastLink(
          `Licença salva com documento anexado!`,
          '📄 Visualizar documento',
          `/api/licenses/${savedLicense.id}/document`
        );
      } else {
        showToast('Licença salva com sucesso.', 'success');
      }
       } catch (err) {
      const detail = err.data && err.data.details;
      showLicError(detail ? `${err.message}: ${detail}` : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar licença';
    }
  }

  function showLicError(msg) {
    const el = $('#lic-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  // ===================================================================
  // E-MAIL
  // ===================================================================
  async function openEmailModal(licenseId) {
    const lic = state.licenses.find((l) => l.id === licenseId) || (await Api.get(`/licenses/${licenseId}`)).license;
    $('#email-license-id').value = licenseId;
    $('#email-tipo').value = 'aviso_renovacao';
    $('#email-anexar-original').checked = !!lic.documento_nome;
    $('#email-anexo-extra').value = '';
    $('#email-error').style.display = 'none';

    const clientData = await Api.get(`/clients/${lic.client_id}`);
    const list = $('#email-destinatarios-list');
    if (!clientData.contacts.length) {
      list.innerHTML = '';
      $('#email-destinatarios-empty').style.display = 'block';
    } else {
      $('#email-destinatarios-empty').style.display = 'none';
      list.innerHTML = clientData.contacts.map((ct) => `
        <label class="tag" style="cursor:pointer;">
          <input type="checkbox" value="${escapeHtml(ct.email)}" ${ct.receber_alertas ? 'checked' : ''} style="width:auto;display:inline-block;margin-right:5px;" />
          ${escapeHtml(ct.nome || ct.email)} (${escapeHtml(ct.email)})
        </label>`).join('');
    }
    openModal('modal-enviar-email');
  }

  async function submitEmailForm(e) {
    e.preventDefault();
    $('#email-error').style.display = 'none';
    const licenseId = Number($('#email-license-id').value);
    const tipo = $('#email-tipo').value;
    const destinatarios = $$('#email-destinatarios-list input:checked').map((i) => i.value);
    if (!destinatarios.length) {
      $('#email-error').textContent = 'Selecione ao menos um destinatário.';
      $('#email-error').style.display = 'block';
      return;
    }
    const body = { licenseId, tipo, destinatarios, anexarDocumentoOriginal: $('#email-anexar-original').checked };
    const fileInput = $('#email-anexo-extra');
    if (fileInput.files[0]) {
      const f = fileInput.files[0];
      body.anexoExtra = { filename: f.name, base64: await fileToBase64(f) };
    }
    const btn = $('#btn-email-enviar');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      await Api.post('/send-email', body);
      closeModal('modal-enviar-email');
      showToast('E-mail enviado com sucesso.', 'success');
      if ($('#view-emails').classList.contains('active')) loadEmailLog();
    } catch (err) {
      $('#email-error').textContent = err.message;
      $('#email-error').style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar e-mail';
    }
  }

  async function loadEmailLog() {
    await loadClients();
    const { emails } = await Api.get('/email-log');
    const wrap = $('#email-log-table-wrap');
    if (!emails.length) { wrap.innerHTML = '<div class="empty-state">Nenhum e-mail enviado ainda.</div>'; return; }
    const tipoLabel = { aviso_renovacao: 'Aviso de renovação', envio_guias: 'Envio de guias', licenca_renovada: 'Licença renovada' };
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th>Destinatários</th><th>Assunto</th><th>Status</th></tr></thead>
        <tbody>
          ${emails.map((e) => `
            <tr>
              <td>${new Date(e.criado_em).toLocaleString('pt-BR')}</td>
              <td>${escapeHtml((state.clientsById[e.client_id] || {}).name || '-')}</td>
              <td>${tipoLabel[e.tipo] || e.tipo}</td>
              <td>${escapeHtml(e.destinatarios)}</td>
              <td>${escapeHtml(e.assunto)}</td>
              <td><span class="badge ${e.status === 'enviado' ? 'ok' : 'vencido'}">${e.status}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ===================================================================
  // LEGISLAÇÃO
  // ===================================================================
  async function loadLegislacaoView() {
    const { legislation } = await Api.get('/legislation');
    const wrap = $('#legislacao-list-wrap');
    if (!legislation.length) { wrap.innerHTML = '<div class="empty-state">Nenhum comunicado publicado.</div>'; return; }
    const isAdmin = state.user.role === 'admin_master';
    wrap.innerHTML = legislation.map((l) => `
      <div class="legis-item">
        <h4>${escapeHtml(l.titulo)} ${l.lida ? '<span class="badge ok">Lida</span>' : '<span class="badge alerta">Não lida</span>'}</h4>
        ${l.descricao ? `<p>${escapeHtml(l.descricao)}</p>` : ''}
        ${l.link ? `<p><a href="${escapeHtml(l.link)}" target="_blank" rel="noopener">${escapeHtml(l.link)}</a></p>` : ''}
        <div class="meta">Publicado em ${new Date(l.criado_em).toLocaleDateString('pt-BR')}</div>
        <div class="row-actions" style="margin-top:8px;">
          ${!l.lida ? `<button class="btn-secondary btn-sm" data-action="ler" data-id="${l.id}">Marcar como lida</button>` : ''}
          ${isAdmin ? `<button class="btn-danger btn-sm" data-action="del-legis" data-id="${l.id}">Excluir</button>` : ''}
        </div>
      </div>`).join('');

    wrap.querySelectorAll('[data-action="ler"]').forEach((el) => el.addEventListener('click', async () => {
      await Api.post(`/legislation/${el.dataset.id}/read`, {});
      loadLegislacaoView();
    }));
    wrap.querySelectorAll('[data-action="del-legis"]').forEach((el) => el.addEventListener('click', async () => {
      if (!confirm('Excluir este comunicado?')) return;
      await Api.del(`/legislation/${el.dataset.id}`);
      loadLegislacaoView();
    }));
  }

  async function checkLegislationBanner() {
    try {
      const { legislation } = await Api.get('/legislation?unread=1');
      if (!legislation.length) return;
      $('#legis-banner-list').innerHTML = legislation.map((l) => `
        <div class="legis-item">
          <h4>${escapeHtml(l.titulo)}</h4>
          ${l.descricao ? `<p>${escapeHtml(l.descricao)}</p>` : ''}
          ${l.link ? `<p><a href="${escapeHtml(l.link)}" target="_blank" rel="noopener">${escapeHtml(l.link)}</a></p>` : ''}
        </div>`).join('');
      window.__unreadLegislationIds = legislation.map((l) => l.id);
      openModal('modal-legis-banner');
    } catch { /* silencioso */ }
  }

  // ===================================================================
  // USUÁRIOS (admin)
  // ===================================================================
  async function loadUsuariosView() {
    const { users } = await Api.get('/users');
    $('#usuarios-table-wrap').innerHTML = `
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td>${escapeHtml(u.name)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${u.role === 'admin_master' ? 'Admin master' : 'Usuário'}</td>
              <td>${u.must_change_password ? '<span class="badge alerta">Precisa trocar senha</span>' : '<span class="badge ok">Ativo</span>'}</td>
              <td><button class="btn-secondary btn-sm" data-action="reset-senha" data-id="${u.id}" data-nome="${escapeHtml(u.name)}">Redefinir senha</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    $('#usuarios-table-wrap').querySelectorAll('[data-action="reset-senha"]').forEach((el) => {
      el.addEventListener('click', () => {
        $('#reset-user-id').value = el.dataset.id;
        $('#reset-user-nome').textContent = `Usuário: ${el.dataset.nome}`;
        $('#reset-nova-senha').value = '';
        openModal('modal-reset-senha');
      });
    });
  }

  // ===================================================================
  // ALTERAR SENHA
  // ===================================================================
  function openForcedChangePassword() {
    $('#change-password-title').textContent = 'Defina sua nova senha';
    $('#field-current-password').style.display = 'none';
    $('#btn-cp-cancelar').style.display = 'none';
    $('#cp-current').required = false;
    openModal('modal-change-password');
  }

  function openVoluntaryChangePassword() {
    $('#change-password-title').textContent = 'Alterar minha senha';
    $('#field-current-password').style.display = 'block';
    $('#btn-cp-cancelar').style.display = 'inline-block';
    $('#cp-current').required = true;
    $('#form-change-password').reset();
    $('#cp-error').style.display = 'none';
    openModal('modal-change-password');
  }

  async function submitChangePassword(e) {
    e.preventDefault();
    const novaSenha = $('#cp-new').value;
    const confirmSenha = $('#cp-confirm').value;
    const errEl = $('#cp-error');
    errEl.style.display = 'none';
    if (novaSenha !== confirmSenha) {
      errEl.textContent = 'As senhas não coincidem.';
      errEl.style.display = 'block';
      return;
    }
    try {
      await Api.post('/change-password', { currentPassword: $('#cp-current').value, newPassword: novaSenha });
      closeModal('modal-change-password');
      state.user.mustChangePassword = false;
      showToast('Senha atualizada com sucesso.', 'success');
      checkLegislationBanner();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }

  // ===================================================================
  // HANDLERS GLOBAIS / FORMS
  // ===================================================================
  function setupGlobalHandlers() {
    $('#btn-logout').addEventListener('click', async () => {
      await Api.post('/logout', {});
      window.location.href = '/index.html';
    });
    $('#btn-change-password').addEventListener('click', openVoluntaryChangePassword);
    $('#form-change-password').addEventListener('submit', submitChangePassword);
    $('#btn-cp-cancelar').addEventListener('click', () => closeModal('modal-change-password'));

    // Dashboard
    $('#dash-search').addEventListener('input', renderDashTable);
    $('#dash-filtro-nivel').addEventListener('change', renderDashTable);

    // Clientes
    $('#clientes-search').addEventListener('input', renderClientesTable);
    $('#btn-novo-cliente').addEventListener('click', () => openClientModal(null));
    $('#btn-editar-cliente').addEventListener('click', () => openClientModal(state.clientsById[state.currentClientId]));
    $('#btn-fechar-cliente').addEventListener('click', () => { $('#cliente-detalhe-panel').style.display = 'none'; $('#clientes-list-panel').style.display = 'block'; });
    $('#btn-cliente-cancelar').addEventListener('click', () => closeModal('modal-cliente'));
    $('#form-cliente').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#cli-nome').value.trim(), cnpj: $('#cli-cnpj').value || null, status: $('#cli-status').value, notes: $('#cli-obs').value || null };
      try {
        if (state.editingClientId) await Api.put(`/clients/${state.editingClientId}`, body);
        else await Api.post('/clients', body);
        closeModal('modal-cliente');
        showToast('Cliente salvo.', 'success');
        await loadClients();
        if (state.currentClientId) openClientDetail(state.currentClientId);
        else renderClientesTable();
      } catch (err) { showToast(err.message, 'error'); }
    });
    $('#btn-cnpj-cancelar').addEventListener('click', () => closeModal('modal-cnpj'));
    $('#form-cnpj').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Api.post(`/clients/${state.currentClientId}/cnpjs`, {
          cnpj: $('#cnpj-valor').value.trim(),
          apelido: $('#cnpj-apelido').value.trim() || null,
        });
        closeModal('modal-cnpj');
        showToast('CNPJ adicionado.', 'success');
        openClientDetail(state.currentClientId);
      } catch (err) { showToast(err.message, 'error'); }
    });
    $('#btn-contato-cancelar').addEventListener('click', () => closeModal('modal-contato'));
    $('#form-contato').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Api.post(`/clients/${state.currentClientId}/contacts`, {
          nome: $('#contato-nome').value || null,
          email: $('#contato-email').value.trim(),
          receberAlertas: $('#contato-receber').checked,
        });
        closeModal('modal-contato');
        showToast('Contato adicionado.', 'success');
        openClientDetail(state.currentClientId);
      } catch (err) { showToast(err.message, 'error'); }
    });

    // Licenças
    $('#lic-search').addEventListener('input', renderLicTable);
    $('#btn-nova-licenca-manual').addEventListener('click', () => openLicenseModal(null));
    $('#btn-nova-licenca-ia').addEventListener('click', () => { openLicenseModal(null); setTimeout(() => $('#lic-upload-drop').click(), 50); });
    $('#btn-licenca-cancelar').addEventListener('click', () => closeModal('modal-licenca'));
    $('#lic-cliente').addEventListener('change', () => updateLicCnpjOptions($('#lic-cliente').value));
    $('#lic-upload-drop').addEventListener('click', () => $('#lic-file-input').click());
    $('#lic-file-input').addEventListener('change', (e) => { if (e.target.files[0]) handleLicenseFileSelected(e.target.files[0]); });
    $('#btn-apenas-anexar').addEventListener('click', attachFileOnly);
    $('#btn-ler-campos').addEventListener('click', extractDocumentFree);
    $('#btn-preview-arquivo').addEventListener('click', previewArquivoSelecionado);
    $('#form-licenca').addEventListener('submit', submitLicenseForm);

    // E-mail
    $('#btn-email-cancelar').addEventListener('click', () => closeModal('modal-enviar-email'));
    $('#form-enviar-email').addEventListener('submit', submitEmailForm);
    $('#btn-refresh-emails').addEventListener('click', loadEmailLog);

    // Legislação
    $('#btn-nova-legislacao').addEventListener('click', () => openModal('modal-legislacao-nova'));
    $('#btn-legislacao-cancelar').addEventListener('click', () => closeModal('modal-legislacao-nova'));
    $('#form-legislacao-nova').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Api.post('/legislation', {
          titulo: $('#legis-titulo').value.trim(),
          descricao: $('#legis-descricao').value || null,
          link: $('#legis-link').value || null,
        });
        closeModal('modal-legislacao-nova');
        $('#form-legislacao-nova').reset();
        showToast('Comunicado publicado.', 'success');
        loadLegislacaoView();
      } catch (err) { showToast(err.message, 'error'); }
    });

    // Banner de legislação
    $('#btn-legis-banner-depois').addEventListener('click', () => closeModal('modal-legis-banner'));
    $('#btn-legis-banner-ok').addEventListener('click', async () => {
      const ids = window.__unreadLegislationIds || [];
      await Promise.all(ids.map((id) => Api.post(`/legislation/${id}/read`, {})));
      closeModal('modal-legis-banner');
    });

    // Reset de senha (admin)
    $('#btn-reset-cancelar').addEventListener('click', () => closeModal('modal-reset-senha'));
    $('#form-reset-senha').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Api.post('/reset-password', { userId: Number($('#reset-user-id').value), newPassword: $('#reset-nova-senha').value });
        closeModal('modal-reset-senha');
        showToast('Senha redefinida.', 'success');
        loadUsuariosView();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  boot();
})();
