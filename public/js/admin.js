const socket = io();

// Elementos da DOM
const revenueSpan = document.getElementById('revenue');
const searchVideoBtn = document.getElementById('searchVideoBtn');
const adminVideoSearchInput = document.getElementById('adminVideoSearchInput');
const adminSearchResultsDiv = document.getElementById('adminSearchResults');

// Elementos da Lista da Casa
const houseListUl = document.getElementById('houseList');
const houseListEmptyMsg = document.getElementById('houseListEmpty');

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

// 2. Buscar um vídeo
if (searchVideoBtn) {
    searchVideoBtn.addEventListener('click', () => {
        console.log("[admin.js] Clique: Buscar"); // Log
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

// 3. Lidar com cliques nos resultados da busca (Adic. Fila / Salvar Lista)
if (adminSearchResultsDiv) {
    adminSearchResultsDiv.addEventListener('click', (e) => {
        const target = e.target;
        
        const resultItem = target.closest('.search-result-item');
        if (!resultItem) return;
        
        const videoId = resultItem.dataset.id;
        const videoTitle = resultItem.dataset.title;
        if (!videoId || !videoTitle) return;

        // Caso 1: Clicou em "Adicionar à Fila"
        if (target.classList.contains('add-result-btn')) {
            console.log("[admin.js] Clique: Adicionar à Fila"); // Log
            socket.emit('admin:addVideo', { videoId: videoId, videoTitle: videoTitle }); 
            alert(`"${videoTitle}" enviado para a fila!`);
        }

        // Caso 2: Clicou em "Salvar na Lista"
        if (target.classList.contains('save-house-list-btn')) {
            console.log("[admin.js] Clique: Salvar na Lista da Casa"); // Log
            socket.emit('admin:saveToHouseList', { id: videoId, title: videoTitle }); 
            alert(`"${videoTitle}" salvo na Lista da Casa!`);
            target.textContent = 'Salvo ✓';
            target.disabled = true;
        }
    });
} else {
    console.error("Erro: Div adminSearchResults não encontrada.");
}

// 4. Controles do Player
if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
        console.log("[admin.js] Clique: Pausar/Tocar"); // Log
        socket.emit('admin:controlPause');
    });
} else {
     console.error("Erro: Botão pauseBtn não encontrado.");
}

if (skipBtn) {
    skipBtn.addEventListener('click', () => {
        console.log("[admin.js] Clique: Pular"); // Log
        socket.emit('admin:controlSkip');
    });
} else {
     console.error("Erro: Botão skipBtn não encontrado.");
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        console.log("[admin.js] Input Volume:", volume); // Log
        if(volumeValueSpan) volumeValueSpan.textContent = `${volume}%`;
        socket.emit('admin:controlVolume', { volume: volume });
    });
} else {
     console.error("Erro: Slider volumeSlider não encontrado.");
}

// 5. Salvar Texto da Promoção
if (savePromoBtn) {
    savePromoBtn.addEventListener('click', () => {
        console.log("[admin.js] Clique: Salvar Promoção"); // Log
        const text = promoTextInput.value.trim();
        socket.emit('admin:setPromoText', text);
        alert('Texto da promoção salvo!');
    });
} else {
    console.error("Erro: Botão savePromoBtn não encontrado.");
}


// 6. Listener para remover item da Lista da Casa
if (houseListUl) {
    houseListUl.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-house-list-btn')) {
            const videoId = e.target.dataset.id;
            if (videoId) {
                console.log('[admin.js] Clique: Remover da Lista da Casa, ID:', videoId); // Log
                socket.emit('admin:removeFromHouseList', { id: videoId });
            }
        }
    });
} else {
    console.error("Erro: Lista da Casa (houseListUl) não encontrada.");
}


// -----------------
// Eventos de Entrada (Ouvindo do Servidor)
// -----------------

// 1. Ao conectar, pede os dados atuais
socket.on('connect', () => {
  console.log('[admin.js] Conectado ao servidor como admin.');
  socket.emit('admin:getList');
});

// 2. Recebe a atualização de faturamento
socket.on('admin:updateRevenue', (amount) => {
  if (revenueSpan) {
    revenueSpan.textContent = amount.toFixed(2).replace('.', ',');
  }
});

// 3. Recebe os resultados da busca do admin
socket.on('admin:searchResults', (results) => {
  console.log('[admin.js] Recebidos resultados da busca:', results.length); // Log
  if (!adminSearchResultsDiv) return; 
  if (results.length === 0) {
    adminSearchResultsDiv.innerHTML = '<p>Nenhum resultado encontrado.</p>';
    return;
  }
  adminSearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">
      <div class="result-info">
        <strong>${video.title}</strong>
        <small>${video.channel}</small>
      </div>
      <div class="result-actions">
          <button class="add-result-btn" title="Adicionar à fila para tocar agora">
            Adic. à Fila
          </button>
          <button class="save-house-list-btn" title="Salvar na lista da casa (para inatividade)">
            Salvar na Lista
          </button>
      </div>
    </div>
  `).join('');
});

// 4. Recebe atualização de volume
socket.on('admin:updateVolume', (data) => {
  console.log('[admin.js] Recebida atualização de volume:', data); // Log
  if (volumeSlider) {
    volumeSlider.value = data.volume;
  }
  if (volumeValueSpan) {
     volumeValueSpan.textContent = `${data.volume}%`;
  }
});

// 5. Recebe atualização do estado do player (Tocando Agora / Fila)
socket.on('updatePlayerState', (state) => {
  console.log('[admin.js] Recebido updatePlayerState:', state); // Log
  // Atualiza o "Tocando Agora"
  if (adminNowPlayingSpan) {
      if (state.nowPlaying) {
        adminNowPlayingSpan.textContent = state.nowPlaying.title;
        if (!state.nowPlaying.isCustomer) {
          adminNowPlayingSpan.textContent += ' (Lista da Casa)';
        }
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

// 6. Recebe o texto promocional atual
socket.on('admin:loadPromoText', (text) => {
  console.log('[admin.js] Carregando texto promo:', text); // Log
  if (promoTextInput) {
    promoTextInput.value = text;
  }
});

// 7. Recebe a Lista da Casa (inicialização)
socket.on('admin:loadHouseList', (houseList) => {
    console.log('[admin.js] Recebendo lista da casa inicial:', houseList);
    renderHouseList(houseList);
});

// 8. Recebe atualização da Lista da Casa (após add/remove)
socket.on('admin:updateHouseList', (houseList) => {
    console.log('[admin.js] Atualizando lista da casa:', houseList);
    renderHouseList(houseList);
});


// Função para renderizar a Lista da Casa
function renderHouseList(list) {
    if (!houseListUl || !houseListEmptyMsg) return;

    if (!list || list.length === 0) {
        houseListUl.innerHTML = ''; // Limpa
        houseListEmptyMsg.style.display = 'block'; // Mostra msg de vazio
    } else {
        houseListEmptyMsg.style.display = 'none'; // Esconde msg de vazio
        houseListUl.innerHTML = list.map(item => `
            <li class="house-list-item">
                <span>${item.title}</span>
                <button class="remove-house-list-btn" data-id="${item.id}" title="Remover da lista">❌</button>
            </li>
        `).join('');
    }
}
