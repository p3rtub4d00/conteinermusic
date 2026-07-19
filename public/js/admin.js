const socket = io();

// Elementos da DOM
const revenueSpan = document.getElementById('revenue');
const resetRevenueBtn = document.getElementById('resetRevenueBtn');
const currentAdminPasswordInput = document.getElementById('currentAdminPassword');
const newAdminPasswordInput = document.getElementById('newAdminPassword');
const confirmAdminPasswordInput = document.getElementById('confirmAdminPassword');
const changeAdminPasswordBtn = document.getElementById('changeAdminPasswordBtn');
const searchVideoBtn = document.getElementById('searchVideoBtn');
const adminVideoSearchInput = document.getElementById('adminVideoSearchInput');
const adminSearchResultsDiv = document.getElementById('adminSearchResults');
const saveListBtn = document.getElementById('saveListBtn');
const inactivityListText = document.getElementById('inactivityList');
const inactivitySearchInput = document.getElementById('inactivitySearchInput');
const inactivitySearchBtn = document.getElementById('inactivitySearchBtn');
const inactivitySearchResultsDiv = document.getElementById('inactivitySearchResults');
const pauseBtn = document.getElementById('pauseBtn');
const skipBtn = document.getElementById('skipBtn');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValueSpan = document.getElementById('volumeValue');
const maxPlaybackMinutesInput = document.getElementById('maxPlaybackMinutesInput');
const saveMaxPlaybackBtn = document.getElementById('saveMaxPlaybackBtn');
const adminNowPlayingSpan = document.getElementById('adminNowPlaying');
const adminNowPlayingMessageSpan = document.getElementById('adminNowPlayingMessage'); 
const adminQueueList = document.getElementById('adminQueueList');
const adminPlayHistoryList = document.getElementById('adminPlayHistory');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const promoTextInput = document.getElementById('promoText');
const savePromoBtn = document.getElementById('savePromoBtn');
let inactivityItems = [];
let isSavingInactivityList = false;

// --- ✨ NOVA FUNÇÃO: Toastify Helper (Igual ao main.js) ---
function showToast(message, type = 'info') {
    let backgroundColor;
    if (type === 'error') backgroundColor = "linear-gradient(to right, #ff5f6d, #ffc371)";
    else if (type === 'success') backgroundColor = "linear-gradient(to right, #00b09b, #96c93d)";
    else backgroundColor = "linear-gradient(to right, #007bff, #00c6ff)";

    Toastify({
        text: message,
        duration: 3000,
        close: true,
        gravity: "top",
        position: "center",
        stopOnFocus: true,
        style: { background: backgroundColor, borderRadius: "8px" },
    }).showToast();
}

// -----------------
// Eventos de Saída
// -----------------

// 1. Salvar lista de inatividade
if (saveListBtn) {
    saveListBtn.addEventListener('click', () => {
        if (isSavingInactivityList) return;
        if (!socket.connected) return showToast('Sem conexão com o servidor. Tente novamente em instantes.', 'error');
        const names = inactivityListText.value.split('\n').map(name => name.trim()).filter(name => name.length > 0);
        const availableItems = [...inactivityItems];
        const itemsToSave = names.map(title => {
            const matchIndex = availableItems.findIndex(item => item.title === title);
            return matchIndex === -1 ? { title } : availableItems.splice(matchIndex, 1)[0];
        });

        isSavingInactivityList = true;
        saveListBtn.disabled = true;
        saveListBtn.textContent = 'Salvando...';
        socket.emit('admin:saveInactivityList', itemsToSave);
    });
}

if (resetRevenueBtn) {
    resetRevenueBtn.addEventListener('click', () => {
        if (!confirm('Deseja zerar o faturamento do dia? Esta ação não apaga os pagamentos registrados.')) return;
        socket.emit('admin:resetRevenue', (result) => {
            if (!result?.ok) return showToast('Não foi possível zerar o faturamento.', 'error');
            showToast('Faturamento do dia zerado.', 'success');
        });
    });
}

if (changeAdminPasswordBtn) {
    changeAdminPasswordBtn.addEventListener('click', async () => {
        const currentPassword = currentAdminPasswordInput?.value || '';
        const newPassword = newAdminPasswordInput?.value || '';
        const confirmation = confirmAdminPasswordInput?.value || '';
        if (!currentPassword || !newPassword) return showToast('Preencha todos os campos de senha.', 'error');
        if (newPassword.length < 8) return showToast('A nova senha deve ter pelo menos 8 caracteres.', 'error');
        if (newPassword !== confirmation) return showToast('A confirmação não corresponde à nova senha.', 'error');

        changeAdminPasswordBtn.disabled = true;
        try {
            const response = await fetch('/admin/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const result = await response.json();
            if (!result?.ok) throw new Error(result?.error || 'Não foi possível alterar a senha.');
            currentAdminPasswordInput.value = '';
            newAdminPasswordInput.value = '';
            confirmAdminPasswordInput.value = '';
            showToast('Senha alterada com sucesso. Use a nova senha no próximo acesso.', 'success');
        } catch (error) {
            showToast(error.message || 'Não foi possível alterar a senha.', 'error');
        } finally {
            changeAdminPasswordBtn.disabled = false;
        }
    });
}

// 2. Buscar vídeo (Fila)
if (searchVideoBtn) {
    searchVideoBtn.addEventListener('click', () => {
        const query = adminVideoSearchInput.value.trim();
        // 🔄 SUBSTITUIÇÃO DE ALERT
        if (!query) return showToast('Por favor, digite um termo para buscar.', 'error');

        adminSearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        socket.emit('admin:search', query);
    });
}

// Busca Lista Inatividade
if (inactivitySearchBtn) {
    inactivitySearchBtn.addEventListener('click', () => {
        const query = inactivitySearchInput.value.trim();
        // 🔄 SUBSTITUIÇÃO DE ALERT
        if (!query) return showToast('Digite algo para buscar.', 'error');

        inactivitySearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        socket.emit('admin:searchForInactivityList', query); 
    });
}

// 3. Adicionar vídeo à fila
if (adminSearchResultsDiv) {
    adminSearchResultsDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-result-btn')) {
            const videoId = e.target.dataset.id;
            const videoTitle = e.target.dataset.title; 

            if (videoId) {
                socket.emit('admin:addVideo', { videoId: videoId, videoTitle: videoTitle }); 
                adminVideoSearchInput.value = '';
                adminSearchResultsDiv.innerHTML = '';
                // 🔄 SUBSTITUIÇÃO DE ALERT
                showToast(`"${videoTitle}" adicionado à fila!`, 'success');
            }
        }
    });
}

// Adicionar à lista de inatividade (UI apenas)
if (inactivitySearchResultsDiv) {
    inactivitySearchResultsDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-inactivity-btn')) {
            const videoTitle = e.target.dataset.title;
            const videoId = e.target.dataset.id;
            if (videoTitle && inactivityListText) {
                // O último texto pode não terminar com Enter. Garanta o
                // separador antes de adicionar outro vídeo, para que dois
                // títulos nunca virem uma única busca.
                const separator = inactivityListText.value.trim().length > 0 ? '\n' : '';
                inactivityListText.value += separator + videoTitle + '\n';
                if (videoId) inactivityItems.push({ title: videoTitle, videoId });
                inactivitySearchInput.value = '';
                inactivitySearchResultsDiv.innerHTML = '';
                showToast('Adicionado ao campo de texto. Clique em "Salvar Lista" para confirmar.', 'info');
            }
        }
    });
}

// 4. Controles do Player
if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
        socket.emit('admin:controlPause');
        showToast('Comando de Pausa/Play enviado.', 'info');
    });
}
if (skipBtn) {
    skipBtn.addEventListener('click', () => {
        if(confirm('Tem certeza que deseja pular a música atual?')) {
            socket.emit('admin:controlSkip');
            showToast('Pulando música...', 'success');
        }
    });
}
if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        if(volumeValueSpan) volumeValueSpan.textContent = `${volume}%`;
        socket.emit('admin:controlVolume', { volume: volume });
    });
}

if (saveMaxPlaybackBtn) {
    saveMaxPlaybackBtn.addEventListener('click', () => {
        const minutes = Number(maxPlaybackMinutesInput?.value);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) {
            showToast('Informe um tempo entre 1 e 30 minutos.', 'error');
            return;
        }
        socket.emit('admin:setMaxPlaybackMinutes', { minutes: Math.round(minutes) });
        showToast('Tempo máximo por música atualizado!', 'success');
    });
}

// 5. Salvar Texto Promo
if (savePromoBtn) {
    savePromoBtn.addEventListener('click', () => {
        const text = promoTextInput.value.trim();
        socket.emit('admin:setPromoText', text);
        // 🔄 SUBSTITUIÇÃO DE ALERT
        showToast('Texto da promoção atualizado na TV!', 'success');
    });
}

if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener('click', () => {
        socket.emit('admin:getPlayHistory');
        showToast('Atualizando histórico...', 'info');
    });
}

// -----------------
// Eventos de Entrada
// -----------------

socket.on('connect', () => {
  console.log('Conectado ao servidor como admin.');
  socket.emit('admin:getList');
});

socket.on('admin:updateRevenue', (amount) => {
  if (revenueSpan) revenueSpan.textContent = amount.toFixed(2).replace('.', ',');
});

socket.on('admin:loadInactivityList', (nameArray) => {
  inactivityItems = (nameArray || []).map(item => typeof item === 'string'
    ? { title: item }
    : { title: item.title, videoId: item.videoId });
  if (inactivityListText) inactivityListText.value = inactivityItems.map(item => item.title).join('\n');
});

socket.on('admin:inactivityListSaved', (result) => {
  isSavingInactivityList = false;
  if (saveListBtn) {
    saveListBtn.disabled = false;
    saveListBtn.textContent = 'Salvar Lista';
  }
  if (!result?.ok) return showToast(result?.error || 'Não foi possível salvar a lista.', 'error');

  inactivityItems = result.items || [];
  if (inactivityListText) inactivityListText.value = inactivityItems.map(item => item.title).join('\n');
  if (result.failedTitles?.length) {
    showToast(`${result.saved} música(s) salva(s). Não encontradas: ${result.failedTitles.join(', ')}`, 'error');
  } else {
    showToast(`${result.saved} música(s) salva(s) na lista de inatividade!`, 'success');
  }
});

socket.on('admin:searchResults', (results) => {
  if (!adminSearchResultsDiv) return;
  if (results.length === 0) {
    adminSearchResultsDiv.innerHTML = '<p>Nenhum resultado encontrado.</p>';
    return;
  }
  adminSearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item">
      <div class="result-info">
        <strong>${video.title}</strong>
        <small>${video.channel}</small>
      </div>
      <button class="add-result-btn" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">Adicionar</button>
    </div>
  `).join('');
});

socket.on('admin:inactivitySearchResults', (results) => {
  if (!inactivitySearchResultsDiv) return; 
  if (results.length === 0) {
    inactivitySearchResultsDiv.innerHTML = '<p>Nenhum resultado encontrado.</p>';
    return;
  }
  inactivitySearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item">
      <div class="result-info">
        <strong>${video.title}</strong>
        <small>${video.channel}</small>
      </div>
      <button class="add-inactivity-btn" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">Adicionar</button>
    </div>
  `).join('');
});

socket.on('admin:updateVolume', (data) => {
  if (volumeSlider) volumeSlider.value = data.volume;
  if (volumeValueSpan) volumeValueSpan.textContent = `${data.volume}%`;
});

socket.on('admin:updateMaxPlaybackMinutes', (minutes) => {
  if (maxPlaybackMinutesInput) {
    maxPlaybackMinutesInput.value = ``;
  }
});

socket.on('updatePlayerState', (state) => {
  if (adminNowPlayingSpan) {
      if (state.nowPlaying) {
        adminNowPlayingSpan.textContent = state.nowPlaying.title + (!state.nowPlaying.isCustomer ? ' (Lista da Casa)' : '');
        if (adminNowPlayingMessageSpan) {
            if (state.nowPlaying.message) {
              adminNowPlayingMessageSpan.textContent = `"${state.nowPlaying.message}"`;
              adminNowPlayingMessageSpan.style.display = 'block';
            } else {
              adminNowPlayingMessageSpan.style.display = 'none';
            }
        }
      } else {
        adminNowPlayingSpan.textContent = 'Nenhuma música tocando...';
        if(adminNowPlayingMessageSpan) adminNowPlayingMessageSpan.style.display = 'none';
      }
  }

  if (adminQueueList) {
      if (state.queue && state.queue.length > 0) {
        adminQueueList.innerHTML = state.queue.map(video => {
          let title = video.title + (!video.isCustomer ? ' (Lista da Casa)' : '');
          if (video.message) title += ` <span class="queue-message">"${video.message}"</span>`;
          return `<li>${title}</li>`;
        }).join('');
      } else {
        adminQueueList.innerHTML = '<li>(Fila vazia)</li>';
      }
  }
});

socket.on('admin:loadPromoText', (text) => {
  if (promoTextInput) promoTextInput.value = text;
});

socket.on('admin:playHistory', (history) => {
  if (!adminPlayHistoryList) return;
  if (!history || history.length === 0) {
    adminPlayHistoryList.innerHTML = '<li>(Nenhuma música registrada ainda)</li>';
    return;
  }

  adminPlayHistoryList.innerHTML = history.map(item => {
    const playedAt = new Date(item.playedAt).toLocaleString('pt-BR');
    const sourceLabel = item.source === 'customer'
      ? 'Cliente'
      : (item.source === 'admin' ? 'Admin' : 'Inatividade');
    const phoneInfo = item.userPhone ? ` | Tel: ${item.userPhone}` : '';
    const messageInfo = item.message ? ` | Msg: "${item.message}"` : '';
    return `<li><strong>${item.title || 'Sem título'}</strong><br><small>${playedAt} | Origem: ${sourceLabel}${phoneInfo}${messageInfo}</small></li>`;
  }).join('');
});

// --------------------------------------------------------------------------
// 🔽 Lógica de Instalação do PWA (Adicionado para funcionar como App) 🔽
// --------------------------------------------------------------------------
let deferredPrompt;
const installBtn = document.getElementById('installAppBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  // Previne que o Chrome mostre o prompt nativo automaticamente (opcional)
  e.preventDefault();
  // Guarda o evento para usar depois
  deferredPrompt = e;
  // Mostra o botão de instalar
  if (installBtn) installBtn.style.display = 'block';
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      deferredPrompt = null;
      // Esconde o botão após instalar
      installBtn.style.display = 'none';
    }
  });
}

window.addEventListener('appinstalled', () => {
  console.log('PWA was installed');
  if (installBtn) installBtn.style.display = 'none';
});
