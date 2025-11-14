const socket = io();

// Elementos da DOM
const revenueSpan = document.getElementById('revenue');
const searchVideoBtn = document.getElementById('searchVideoBtn');
const adminVideoSearchInput = document.getElementById('adminVideoSearchInput');
const adminSearchResultsDiv = document.getElementById('adminSearchResults');
// const saveListBtn = document.getElementById('saveListBtn'); // REMOVIDO
// const inactivityListText = document.getElementById('inactivityList'); // REMOVIDO

// ❗️ NOVO: Elementos da Lista da Casa
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

// ❗️ REMOVIDO: saveListBtn.addEventListener('click', ...)

// 2. Buscar um vídeo
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

// 3. ❗️ MODIFICADO: Lidar com cliques nos resultados da busca (Agora 2 botões)
if (adminSearchResultsDiv) {
    adminSearchResultsDiv.addEventListener('click', (e) => {
        const target = e.target;
        
        // Pega os dados do item pai
        const resultItem = target.closest('.search-result-item');
        if (!resultItem) return;
        
        const videoId = resultItem.dataset.id;
        const videoTitle = resultItem.dataset.title;
        if (!videoId || !videoTitle) return;

        // Caso 1: Clicou em "Adicionar à Fila"
        if (target.classList.contains('add-result-btn')) {
            socket.emit('admin:addVideo', { videoId: videoId, videoTitle: videoTitle }); 
            alert(`"${videoTitle}" enviado para a fila!`);
            // Limpa apenas se adicionou à fila? Opcional.
            // adminVideoSearchInput.value = '';
            // adminSearchResultsDiv.innerHTML = '';
        }

        // Caso 2: Clicou em "Salvar na Lista"
        if (target.classList.contains('save-house-list-btn')) {
            socket.emit('admin:saveToHouseList', { id: videoId, title: videoTitle }); 
            alert(`"${videoTitle}" salvo na Lista da Casa!`);
            // Desabilita o botão para feedback
            target.textContent = 'Salvo ✓';
            target.disabled = true;
        }
    });
} else {
    console.error("Erro: Div adminSearchResults não encontrada.");
}

// 4. Controles do Player
if (pauseBtn) { /* ... (inalterado) ... */ }
if (skipBtn) { /* ... (inalterado) ... */ }
if (volumeSlider) { /* ... (inalterado) ... */ }

// 5. Salvar Texto da Promoção
if (savePromoBtn) { /* ... (inalterado) ... */ }


// 6. ❗️ NOVO: Listener para remover item da Lista da Casa
if (houseListUl) {
    houseListUl.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-house-list-btn')) {
            const videoId = e.target.dataset.id;
            if (videoId) {
                console.log('Solicitando remoção do ID:', videoId);
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
  console.log('Conectado ao servidor como admin.');
  socket.emit('admin:getList');
});

// 2. Recebe a atualização de faturamento
socket.on('admin:updateRevenue', (amount) => { /* ... (inalterado) ... */ });

// 3. ❗️ REMOVIDO: admin:loadInactivityList

// 4. Recebe os resultados da busca do admin
socket.on('admin:searchResults', (results) => {
  if (!adminSearchResultsDiv) return; 
  if (results.length === 0) {
    adminSearchResultsDiv.innerHTML = '<p>Nenhum resultado encontrado.</p>';
    return;
  }

  // ❗️ MODIFICADO: Renderiza DOIS botões
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

// 5. Recebe atualização de volume
socket.on('admin:updateVolume', (data) => { /* ... (inalterado) ... */ });

// 6. Recebe atualização do estado do player (Tocando Agora / Fila)
socket.on('updatePlayerState', (state) => { /* ... (inalterado) ... */ });

// 7. Recebe o texto promocional atual
socket.on('admin:loadPromoText', (text) => { /* ... (inalterado) ... */ });

// 8. ❗️ NOVO: Recebe a Lista da Casa (inicialização)
socket.on('admin:loadHouseList', (houseList) => {
    console.log('Recebendo lista da casa inicial:', houseList);
    renderHouseList(houseList);
});

// 9. ❗️ NOVO: Recebe atualização da Lista da Casa (após add/remove)
socket.on('admin:updateHouseList', (houseList) => {
    console.log('Atualizando lista da casa:', houseList);
    renderHouseList(houseList);
});


// ❗️ NOVO: Função para renderizar a Lista da Casa
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
