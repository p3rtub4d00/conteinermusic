const socket = io();

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

const autoplayModeSelect = document.getElementById('autoplayMode');
const manualAutoplaySection = document.getElementById('manualAutoplaySection');
const playlistAutoplaySection = document.getElementById('playlistAutoplaySection');

let inactivityItems = [];
let isSavingInactivityList = false;

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

if (autoplayModeSelect) {
    autoplayModeSelect.addEventListener('change', (e) => {
        const mode = e.target.value;
        if (mode === 'playlist') {
            manualAutoplaySection.style.display = 'none';
            playlistAutoplaySection.style.display = 'block';
        } else {
            manualAutoplaySection.style.display = 'block';
            playlistAutoplaySection.style.display = 'none';
        }
        socket.emit('admin:setAutoplayMode', mode);
        showToast(`Modo alterado para: ${mode === 'playlist' ? 'Playlist Dinâmica' : 'Lista Manual'}`, 'info');
    });
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.genre-select-btn');
    if (btn) {
        const link = btn.dataset.link;
        const genreName = btn.textContent.trim();

        document.querySelectorAll('.genre-select-btn').forEach(b => {
            b.style.opacity = '0.7';
            b.style.transform = 'scale(1)';
        });
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1.02)';

        socket.emit('admin:savePlaylistLink', link, (response) => {
            if (response && response.ok) {
                showToast(`Autoplay ativado: ${genreName}!`, 'success');
            } else {
                showToast('Erro ao ativar o gênero.', 'error');
            }
        });
    }
});

if (saveListBtn) {
    saveListBtn.addEventListener('click', () => {
        if (isSavingInactivityList) return;
        if (!socket.connected) return showToast('Sem conexão com o servidor.', 'error');
        const names = inactivityListText.value.split('\n').map(name => name.trim()).filter(name => name.length > 0);
        const availableItems = [...inactivityItems];
        const itemsToSave = names.map(title => {
            const matchIndex = availableItems.findIndex(item => item.title === title);
            return matchIndex === -1 ? { title } : availableItems.splice(matchIndex, 1)[0];
        });

        isSavingInactivityList = true;
        saveListBtn.disabled = true;
        saveListBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        socket.emit('admin:saveInactivityList', itemsToSave);
    });
}

if (resetRevenueBtn) {
    resetRevenueBtn.addEventListener('click', () => {
        if (!confirm('Deseja zerar o faturamento do dia?')) return;
        socket.emit('admin:resetRevenue', (result) => {
            if (!result?.ok) return showToast('Erro ao zerar faturamento.', 'error');
            showToast('Faturamento do dia zerado.', 'success');
        });
    });
}

if (changeAdminPasswordBtn) {
    changeAdminPasswordBtn.addEventListener('click', async () => {
        const currentPassword = currentAdminPasswordInput?.value || '';
        const newPassword = newAdminPasswordInput?.value || '';
        const confirmation = confirmAdminPasswordInput?.value || '';
        if (!currentPassword || !newPassword) return showToast('Preencha os campos de senha.', 'error');
        if (newPassword.length < 8) return showToast('A senha deve ter pelo menos 8 caracteres.', 'error');
        if (newPassword !== confirmation) return showToast('As senhas não coincidem.', 'error');

        changeAdminPasswordBtn.disabled = true;
        try {
            const response = await fetch('/admin/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const result = await response.json();
            if (!result?.ok) throw new Error(result?.error || 'Erro ao alterar senha.');
            currentAdminPasswordInput.value = '';
            newAdminPasswordInput.value = '';
            confirmAdminPasswordInput.value = '';
            showToast('Senha alterada com sucesso!', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            changeAdminPasswordBtn.disabled = false;
        }
    });
}

if (searchVideoBtn) {
    searchVideoBtn.addEventListener('click', () => {
        const query = adminVideoSearchInput.value.trim();
        if (!query) return showToast('Digite um termo para buscar.', 'error');
        adminSearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        socket.emit('admin:search', query);
    });
}

if (inactivitySearchBtn) {
    inactivitySearchBtn.addEventListener('click', () => {
        const query = inactivitySearchInput.value.trim();
        if (!query) return showToast('Digite algo para buscar.', 'error');
        inactivitySearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        socket.emit('admin:searchForInactivityList', query); 
    });
}

if (adminSearchResultsDiv) {
    adminSearchResultsDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-result-btn')) {
            const videoId = e.target.dataset.id;
            const videoTitle = e.target.dataset.title; 
            if (videoId) {
                socket.emit('admin:addVideo', { videoId, videoTitle }); 
                adminVideoSearchInput.value = '';
                adminSearchResultsDiv.innerHTML = '';
                showToast(`"${videoTitle}" adicionado à fila!`, 'success');
            }
        }
    });
}

if (inactivitySearchResultsDiv) {
    inactivitySearchResultsDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-inactivity-btn')) {
            const videoTitle = e.target.dataset.title;
            const videoId = e.target.dataset.id;
            if (videoTitle && inactivityListText) {
                const separator = inactivityListText.value.trim().length > 0 ? '\n' : '';
                inactivityListText.value += separator + videoTitle + '\n';
                if (videoId) inactivityItems.push({ title: videoTitle, videoId });
                inactivitySearchInput.value = '';
                inactivitySearchResultsDiv.innerHTML = '';
                showToast('Adicionado ao campo. Clique em "Salvar Lista Manual".', 'info');
            }
        }
    });
}

if (pauseBtn) {
    pauseBtn.addEventListener('click', () => socket.emit('admin:controlPause'));
}

if (skipBtn) {
    skipBtn.addEventListener('click', () => {
        if(confirm('Deseja pular a música atual?')) socket.emit('admin:controlSkip');
    });
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        if(volumeValueSpan) volumeValueSpan.textContent = `${volume}%`;
        socket.emit('admin:controlVolume', { volume });
    });
}

if (saveMaxPlaybackBtn) {
    saveMaxPlaybackBtn.addEventListener('click', () => {
        const minutes = Number(maxPlaybackMinutesInput?.value);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) {
            return showToast('Informe um tempo entre 1 e 30 minutos.', 'error');
        }
        socket.emit('admin:setMaxPlaybackMinutes', { minutes: Math.round(minutes) });
        showToast('Tempo máximo atualizado!', 'success');
    });
}

if (savePromoBtn) {
    savePromoBtn.addEventListener('click', () => {
        socket.emit('admin:setPromoText', promoTextInput.value.trim());
        showToast('Promoção atualizada na TV!', 'success');
    });
}

if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener('click', () => socket.emit('admin:getPlayHistory'));
}

socket.on('connect', () => socket.emit('admin:getList'));
socket.on('admin:updateRevenue', (amount) => {
  if (revenueSpan) revenueSpan.textContent = amount.toFixed(2).replace('.', ',');
});

socket.on('admin:loadInactivityList', (nameArray) => {
  inactivityItems = (nameArray || []).map(item => typeof item === 'string' ? { title: item } : { title: item.title, videoId: item.videoId });
  if (inactivityListText) inactivityListText.value = inactivityItems.map(item => item.title).join('\n');
});

socket.on('admin:loadAutoplayConfig', (config) => {
    if (config.mode && autoplayModeSelect) {
        autoplayModeSelect.value = config.mode;
        autoplayModeSelect.dispatchEvent(new Event('change')); 
    }
});

socket.on('admin:inactivityListSaved', (result) => {
  isSavingInactivityList = false;
  if (saveListBtn) {
    saveListBtn.disabled = false;
    saveListBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Lista Manual';
  }
  if (!result?.ok) return showToast(result?.error || 'Erro ao salvar lista.', 'error');
  inactivityItems = result.items || [];
  if (inactivityListText) inactivityListText.value = inactivityItems.map(item => item.title).join('\n');
  showToast(`${result.saved} música(s) salva(s) com sucesso!`, 'success');
});

socket.on('admin:searchResults', (results) => {
  if (!adminSearchResultsDiv) return;
  if (results.length === 0) return adminSearchResultsDiv.innerHTML = '<p>Nenhum resultado.</p>';
  adminSearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item">
      <div class="result-info"><strong>${video.title}</strong><small>${video.channel}</small></div>
      <button class="add-result-btn" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">Adicionar</button>
    </div>
  `).join('');
});

socket.on('admin:inactivitySearchResults', (results) => {
  if (!inactivitySearchResultsDiv) return; 
  if (results.length === 0) return inactivitySearchResultsDiv.innerHTML = '<p>Nenhum resultado.</p>';
  inactivitySearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item">
      <div class="result-info"><strong>${video.title}</strong><small>${video.channel}</small></div>
      <button class="add-inactivity-btn" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">Adicionar</button>
    </div>
  `).join('');
});

socket.on('admin:updateVolume', (data) => {
  if (volumeSlider) volumeSlider.value = data.volume;
  if (volumeValueSpan) volumeValueSpan.textContent = `${data.volume}%`;
});

socket.on('admin:updateMaxPlaybackMinutes', (minutes) => {
  if (maxPlaybackMinutesInput) maxPlaybackMinutesInput.value = minutes;
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
  if (!history || history.length === 0) return adminPlayHistoryList.innerHTML = '<li>(Nenhuma música registrada)</li>';

  adminPlayHistoryList.innerHTML = history.map(item => {
    const playedAt = new Date(item.playedAt).toLocaleString('pt-BR');
    const sourceLabel = item.source === 'customer' ? 'Cliente' : (item.source === 'admin' ? 'Admin' : 'Inatividade');
    const phoneInfo = item.userPhone ? ` | Tel: ${item.userPhone}` : '';
    const messageInfo = item.message ? ` | Msg: "${item.message}"` : '';
    return `<li><strong>${item.title || 'Sem título'}</strong><br><small>${playedAt} | Origem: ${sourceLabel}${phoneInfo}${messageInfo}</small></li>`;
  }).join('');
});

let deferredPrompt;
const installBtn = document.getElementById('installAppBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = 'block';
});
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
      installBtn.style.display = 'none';
    }
  });
}
