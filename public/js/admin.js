const socket = io();

// Elementos da DOM
const revenueSpan = document.getElementById('revenue');
const searchVideoBtn = document.getElementById('searchVideoBtn');
const adminVideoSearchInput = document.getElementById('adminVideoSearchInput');
const adminSearchResultsDiv = document.getElementById('adminSearchResults');
const saveListBtn = document.getElementById('saveListBtn');
const inactivityListText = document.getElementById('inactivityList');

// [MUDANÇA] Novos elementos da busca de inatividade
const inactivitySearchInput = document.getElementById('inactivitySearchInput');
const inactivitySearchBtn = document.getElementById('inactivitySearchBtn');
const inactivitySearchResultsDiv = document.getElementById('inactivitySearchResults');
// [FIM DA MUDANÇA]

// Elementos de Controle do Player
const pauseBtn = document.getElementById('pauseBtn');
const skipBtn = document.getElementById('skipBtn');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValueSpan = document.getElementById('volumeValue');

// Elementos da Fila
const adminNowPlayingSpan = document.getElementById('adminNowPlaying');
const adminNowPlayingMessageSpan = document.getElementById('adminNowPlayingMessage'); 
const adminQueueList = document.getElementById('adminQueueList');

// Elementos da Promoção
const promoTextInput = document.getElementById('promoText');
const savePromoBtn = document.getElementById('savePromoBtn');


// -----------------
// Eventos de Saída (Enviando para o Servidor)
// -----------------

// 1. Salvar a lista de inatividade (por nome)
// Garante que o botão existe antes de adicionar listener
if (saveListBtn) {
    saveListBtn.addEventListener('click', () => {
        const names = inactivityListText.value
            .split('\n') 
            .map(name => name.trim()) 
            .filter(name => name.length > 0); 
        
        socket.emit('admin:saveInactivityList', names);
        alert('Lista de inatividade salva!');
    });
} else {
    console.error("Erro: Botão saveListBtn não encontrado.");
}

// 2. Buscar um vídeo (para Fila Principal)
if (searchVideoBtn) {
    searchVideoBtn.addEventListener('click', () => {
        const query = adminVideoSearchInput.value.trim();
        if (!query) {
            return alert('Por favor, digite um termo para buscar.');
        }

        adminSearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        socket.emit('admin:search', query);
    });
} else {
    console.error("Erro: Botão searchVideoBtn não encontrado.");
}

// [MUDANÇA] Novo listener para a busca da lista de inatividade
if (inactivitySearchBtn) {
    inactivitySearchBtn.addEventListener('click', () => {
        const query = inactivitySearchInput.value.trim();
        if (!query) {
            return alert('Por favor, digite um termo para buscar.');
        }

        inactivitySearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        // Emite o NOVO evento
        socket.emit('admin:searchForInactivityList', query); 
    });
} else {
    console.error("Erro: Botão inactivitySearchBtn não encontrado.");
}
// [FIM DA MUDANÇA]

// 3. Lidar com cliques nos resultados da busca (Fila Principal)
if (adminSearchResultsDiv) {
    adminSearchResultsDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-result-btn')) {
            const videoId = e.target.dataset.id;
            const videoTitle = e.target.dataset.title; 

            if (videoId) {
                socket.emit('admin:addVideo', { videoId: videoId, videoTitle: videoTitle }); 
                
                adminVideoSearchInput.value = '';
                adminSearchResultsDiv.innerHTML = '';
                
                alert(`"${videoTitle}" enviado para a fila!`);
            }
        }
    });
} else {
    console.error("Erro: Div adminSearchResults não encontrada.");
}

// [MUDANÇA] Novo listener de clique para os resultados da lista de inatividade
if (inactivitySearchResultsDiv) {
    inactivitySearchResultsDiv.addEventListener('click', (e) => {
        // Verifica se o clique foi no botão 'add-inactivity-btn'
        if (e.target.classList.contains('add-inactivity-btn')) {
            const videoTitle = e.target.dataset.title; // Pega o título

            if (videoTitle && inactivityListText) {
                // Adiciona o título em uma nova linha no textarea
                inactivityListText.value += videoTitle + '\n';
                
                // Limpa os resultados e o campo de busca
                inactivitySearchInput.value = '';
                inactivitySearchResultsDiv.innerHTML = '';
            }
        }
    });
} else {
    console.error("Erro: Div inactivitySearchResultsDiv não encontrada.");
}
// [FIM DA MUDANÇA]


// 4. Controles do Player
if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
        socket.emit('admin:controlPause');
    });
} else {
     console.error("Erro: Botão pauseBtn não encontrado.");
}

if (skipBtn) {
    skipBtn.addEventListener('click', () => {
        socket.emit('admin:controlSkip');
    });
} else {
     console.error("Erro: Botão skipBtn não encontrado.");
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        if(volumeValueSpan) volumeValueSpan.textContent = `${volume}%`;
        socket.emit('admin:controlVolume', { volume: volume });
    });
} else {
     console.error("Erro: Slider volumeSlider não encontrado.");
}

// 5. Salvar Texto da Promoção
if (savePromoBtn) {
    savePromoBtn.addEventListener('click', () => {
        const text = promoTextInput.value.trim();
        socket.emit('admin:setPromoText', text);
        alert('Texto da promoção salvo!');
    });
} else {
    console.error("Erro: Botão savePromoBtn não encontrado.");
}


// -----------------
// Eventos de Entrada (Ouvindo do Servidor)
// -----------------

// 1. Ao conectar, pede os dados atuais
socket.on('connect', () => {
  console.log('Conectado ao servidor como admin.');
  socket.emit('admin:getList');
});

// 2. Recebe a atualização de faturamento
socket.on('admin:updateRevenue', (amount) => {
  if (revenueSpan) {
    revenueSpan.textContent = amount.toFixed(2).replace('.', ',');
  }
});

// 3. Recebe a lista de inatividade (nomes)
socket.on('admin:loadInactivityList', (nameArray) => {
  if (inactivityListText) {
    inactivityListText.value = nameArray.join('\n');
  }
});

// 4. Recebe os resultados da busca do admin (Fila Principal)
socket.on('admin:searchResults', (results) => {
  if (!adminSearchResultsDiv) return; // Segurança extra
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
      <button class="add-result-btn" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">
        Adicionar
      </button>
    </div>
  `).join('');
});

// [MUDANÇA] Novo listener para os resultados da lista de inatividade
socket.on('admin:inactivitySearchResults', (results) => {
  if (!inactivitySearchResultsDiv) return; 
  if (results.length === 0) {
    inactivitySearchResultsDiv.innerHTML = '<p>Nenhum resultado encontrado.</p>';
    return;
  }

  // Gera o HTML dos resultados
  inactivitySearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item">
      <div class="result-info">
        <strong>${video.title}</strong>
        <small>${video.channel}</small>
      </div>
      <button class="add-inactivity-btn" data-title="${video.title.replace(/"/g, "'")}">
        Adicionar
      </button>
    </div>
  `).join('');
});
// [FIM DA MUDANÇA]


// 5. Recebe atualização de volume
socket.on('admin:updateVolume', (data) => {
  if (volumeSlider) {
    volumeSlider.value = data.volume;
  }
  if (volumeValueSpan) {
     volumeValueSpan.textContent = `${data.volume}%`;
  }
});

// 6. Recebe atualização do estado do player (Tocando Agora / Fila)
socket.on('updatePlayerState', (state) => {
  // Atualiza o "Tocando Agora"
  if (adminNowPlayingSpan) {
      if (state.nowPlaying) {
        adminNowPlayingSpan.textContent = state.nowPlaying.title;
        if (!state.nowPlaying.isCustomer) {
          adminNowPlayingSpan.textContent += ' (Lista da Casa)';
        }
        // Mostra a mensagem se houver
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

  // Atualiza a "Próxima da Fila"
  if (adminQueueList) {
      if (state.queue && state.queue.length > 0) {
        adminQueueList.innerHTML = state.queue.map(video => {
          let title = video.title;
          if (!video.isCustomer) {
            title += ' (Lista da Casa)';
          }
          if (video.message) {
             title += ` <span class="queue-message">"${video.message}"</span>`;
          }
          return `<li>${title}</li>`;
        }).join('');
      } else {
        adminQueueList.innerHTML = '<li>(Fila vazia)</li>';
      }
  }
});

// 7. Recebe o texto promocional atual
socket.on('admin:loadPromoText', (text) => {
  if (promoTextInput) {
    promoTextInput.value = text;
  }
});
