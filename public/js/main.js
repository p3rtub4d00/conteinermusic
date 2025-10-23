const socket = io(); 

// --- Elementos da DOM ---
const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const selectedList = document.getElementById('selected');
const countSpan = document.getElementById('count');
const pagarBtn = document.getElementById('pagarBtn');
const simularBtn = document.getElementById('simularBtn'); 
const pixArea = document.getElementById('pixArea');
const nowPlayingArea = document.getElementById('now-playing-area');
const nowPlayingTitleSpan = document.getElementById('nowPlayingTitle');
const packageRadios = document.querySelectorAll('input[name="package"]');
const limitSpan = document.getElementById('limit'); 

// Elementos do Modal
const messageModal = document.getElementById('messageModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalBtnYes = document.getElementById('modalBtnYes');
const modalBtnNo = document.getElementById('modalBtnNo');
const modalInitialButtons = document.getElementById('modalInitialButtons');
const modalMessageInputArea = document.getElementById('modalMessageInputArea');
const modalMessageText = document.getElementById('modalMessageText');
const modalBtnConfirm = document.getElementById('modalBtnConfirm');
const MESSAGE_COST = 1.00; 

// --- Estado Global do Cliente ---
let selectedPackage = {
  limit: 3,
  price: 2.00,
  description: "Pacote 3 Músicas"
};
let selectedVideos = []; // Armazena objetos { id, title }
let finalAmount = 0; 
let finalDescription = ""; 
let finalMessage = null; 

// --- Funções Auxiliares ---

function updateSelectedPackage() {
    const checkedRadio = document.querySelector('input[name="package"]:checked');
    if (!checkedRadio) return; 
    selectedPackage.limit = parseInt(checkedRadio.dataset.limit, 10);
    selectedPackage.price = parseFloat(checkedRadio.dataset.price);
    selectedPackage.description = `Pacote ${selectedPackage.limit} Músicas`;
    
    if (limitSpan) limitSpan.textContent = selectedPackage.limit;
    
    if (selectedVideos.length > selectedPackage.limit) {
        selectedVideos.splice(selectedPackage.limit); 
        if(resultsDiv){
            resultsDiv.querySelectorAll('.video-item.selected-video').forEach(card => {
                const cardId = card.dataset.videoId;
                if (!selectedVideos.some(v => v.id === cardId)) { 
                    card.classList.remove('selected-video');
                    const button = card.querySelector('.select-btn');
                    if (button) {
                        button.textContent = 'Selecionar';
                        button.disabled = false;
                    }
                }
            });
        }
    }
    updatePaymentButtonText(); 
    atualizarLista(); 
}

function updatePaymentButtonText() {
    if (!pagarBtn) return; 
    pagarBtn.textContent = `Pagar R$ ${selectedPackage.price.toFixed(2).replace('.', ',')} (PIX)`;
    const canPay = selectedVideos.length === selectedPackage.limit; 
    pagarBtn.disabled = !canPay;
    if (simularBtn) simularBtn.disabled = !canPay; 
}

// Função de Busca (Com aplicação de estado visual inicial)
async function buscarVideos() {
  if (!searchInput || !resultsDiv) return; 

  const q = searchInput.value.trim();
  if (!q) return alert('Digite algo para buscar!');

  resultsDiv.innerHTML = '<p>Buscando...</p>';
  if (pixArea) pixArea.style.display = 'none'; 
  
  try {
      const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Erro na rede: ${res.statusText}`);
      const data = await res.json();

      if (!data.ok) {
        resultsDiv.innerHTML = '<p>Erro na busca!</p>';
        return;
      }

      if (data.results.length === 0) {
         resultsDiv.innerHTML = '<p>Nenhum resultado encontrado.</p>';
         return;
      }

      const selectedIds = selectedVideos.map(v => v.id);

      resultsDiv.innerHTML = data.results
        .map( v => {
          const isSelected = selectedIds.includes(v.id);
          const buttonText = isSelected ? 'Selecionado ✓' : 'Selecionar';
          const buttonDisabled = isSelected ? 'disabled' : '';
          const cardClass = isSelected ? 'video-item selected-video' : 'video-item';

          return `
            <div class="${cardClass}" data-video-id="${v.id}"> 
              <img src="${v.thumbnail}" alt="">
              <div class="info">
                <strong>${v.title}</strong><br>
                <small>${v.channel}</small><br>
                <button class="select-btn" onclick="addVideo('${v.id}', '${v.title.replace(/'/g, "\\'")}')" ${buttonDisabled}>
                  ${buttonText}
                </button>
              </div>
            </div>
          `;
        })
        .join('');
  } catch (error) {
      console.error("Erro ao buscar vídeos:", error);
      resultsDiv.innerHTML = '<p>Ocorreu um erro ao buscar. Tente novamente.</p>';
  }
}

// Adiciona Vídeo (Com feedback visual)
window.addVideo = (id, title) => {
  if (selectedVideos.find(v => v.id === id)) return; 
  if (selectedVideos.length >= selectedPackage.limit) { 
    alert(`Limite máximo de ${selectedPackage.limit} músicas atingido!`);
    return;
  }

  selectedVideos.push({ id, title }); 
  atualizarLista(); 

  if (resultsDiv) {
      const card = resultsDiv.querySelector(`.video-item[data-video-id="${id}"]`);
      if (card) {
          card.classList.add('selected-video');
          const button = card.querySelector('.select-btn');
          if (button) {
              button.textContent = 'Selecionado ✓';
              button.disabled = true;
          }
      }
  }
};

// Atualiza a lista lateral e os botões de ação
function atualizarLista() {
  if (selectedList) {
      selectedList.innerHTML = selectedVideos
        .map(v => `<li>${v.title} <button onclick="removerVideo('${v.id}')">❌</button></li>`)
        .join('');
  }
  if (countSpan) countSpan.textContent = selectedVideos.length;
  updatePaymentButtonText(); 
}

// Remove Vídeo (Com feedback visual)
window.removerVideo = id => {
  selectedVideos = selectedVideos.filter(v => v.id !== id);
  atualizarLista(); 

  if (resultsDiv) {
      const card = resultsDiv.querySelector(`.video-item[data-video-id="${id}"]`);
       if (card) {
          card.classList.remove('selected-video');
          const button = card.querySelector('.select-btn');
          if (button) {
              button.textContent = 'Selecionar';
              button.disabled = false;
          }
      }
  }
};

// ❗️❗️ [MODIFICADO] Reseta a UI após ação ❗️❗️
function resetUI() {
  console.log("Chamando resetUI()..."); // Log para confirmar
  selectedVideos = [];
  atualizarLista(); // Limpa lista lateral e desabilita botões
  if (pixArea) pixArea.style.display = 'none';
  if (resultsDiv) {
      // ❗️ RESTAURADO: Limpa os resultados da busca ❗️
      resultsDiv.innerHTML = ''; 
  }
  if (searchInput) searchInput.value = '';
  if (messageModal) messageModal.style.display = 'none'; 
  console.log("resetUI() finalizado."); // Log para confirmar
}


// Função que processa o pagamento (chamada pelo modal ou botão 'Não')
async function proceedToPayment() {
  if(pagarBtn) pagarBtn.disabled = true; 
  if(simularBtn) simularBtn.disabled = true;

  const videos = selectedVideos; 

  console.log("Enviando para pagamento:", { videos, amount: finalAmount, description: finalDescription, message: finalMessage });

  try {
      const res = await fetch('/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          videos: videos, 
          amount: finalAmount,
          description: finalDescription,
          message: finalMessage 
        }) 
      });

      const data = await res.json();
      
      if (!res.ok || !data.ok) { 
        throw new Error(data.error || `Erro ${res.status}: ${res.statusText}`);
      }

      if (pixArea) pixArea.style.display = 'block';
      const qrCodeImg = document.getElementById('qrCode');
      const copiaColaText = document.getElementById('copiaCola');
      if(qrCodeImg) qrCodeImg.src = `data:image/png;base64,${data.qr}`;
      if(copiaColaText) copiaColaText.value = data.copiaCola;
      
      resetUI(); // Chama o reset AQUI após sucesso

  } catch (error) {
       console.error("Erro detalhado ao gerar pagamento:", error); 
       alert(`Erro ao gerar pagamento: ${error.message}`);
       updatePaymentButtonText(); // Reabilita botões se falhar
  }
}

// --- Event Listeners ---

if (searchBtn) {
    searchBtn.addEventListener('click', buscarVideos);
} else {
    console.error("Erro crítico: Botão 'Buscar' (searchBtn) não encontrado!");
}

if (packageRadios) {
    packageRadios.forEach(radio => {
      radio.addEventListener('change', updateSelectedPackage);
    });
}

// Listeners do Modal e Pagamento
if (pagarBtn) {
    pagarBtn.addEventListener('click', () => {
      if (selectedVideos.length !== selectedPackage.limit) return; 
      if (!messageModal) return console.error("Modal não encontrado!");

      if(modalInitialButtons) modalInitialButtons.style.display = 'flex';
      if(modalMessageInputArea) modalMessageInputArea.style.display = 'none';
      if(modalMessageText) modalMessageText.value = ''; 
      finalMessage = null; 
      finalAmount = selectedPackage.price; 
      finalDescription = selectedPackage.description; 

      messageModal.style.display = 'flex'; 
    });
} else {
    console.error("Erro crítico: Botão 'Pagar' (pagarBtn) não encontrado!");
}

if (modalBtnNo) {
    modalBtnNo.addEventListener('click', () => {
      if(messageModal) messageModal.style.display = 'none';
      proceedToPayment(); 
    });
} else { console.error("Botão modalBtnNo não encontrado!"); }

if (modalBtnYes) {
    modalBtnYes.addEventListener('click', () => {
      if(modalInitialButtons) modalInitialButtons.style.display = 'none';
      if(modalMessageInputArea) modalMessageInputArea.style.display = 'block';
      finalAmount = selectedPackage.price + MESSAGE_COST; 
      finalDescription = selectedPackage.description + " + Mensagem"; 
      if(modalBtnConfirm) modalBtnConfirm.textContent = `Confirmar e Pagar R$ ${finalAmount.toFixed(2).replace('.', ',')}`; 
      if(modalMessageText) modalMessageText.focus(); 
    });
} else { console.error("Botão modalBtnYes não encontrado!"); }

if (modalBtnConfirm) {
    modalBtnConfirm.addEventListener('click', () => {
      if(modalMessageText) finalMessage = modalMessageText.value.trim(); 
      if(messageModal) messageModal.style.display = 'none';
      proceedToPayment(); 
    });
} else { console.error("Botão modalBtnConfirm não encontrado!"); }

if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      if(messageModal) messageModal.style.display = 'none';
    });
} else { console.error("Botão modalCloseBtn não encontrado!"); }

if (messageModal) {
    messageModal.addEventListener('click', (e) => {
      if (e.target === messageModal) { 
        messageModal.style.display = 'none';
      }
    });
} else { console.error("Modal messageModal não encontrado!"); }

// Listener de Simulação
if (simularBtn) {
    simularBtn.addEventListener('click', () => {
      const videos = selectedVideos; 
      if (videos.length === 0) return; 

      socket.emit('simulatePlay', { 
        videos: videos,
        message: null // Simulação não inclui mensagem 
      });

      resetUI(); // Chama o reset AQUI após simular
    });
} else { console.error("Botão simularBtn não encontrado!"); }

// --- Listener Socket.io ---
socket.on('updatePlayerState', (state) => {
  if (nowPlayingArea) {
      if (state.nowPlaying) {
        if(nowPlayingTitleSpan) nowPlayingTitleSpan.textContent = state.nowPlaying.title;
        nowPlayingArea.style.display = 'block';
      } else {
        nowPlayingArea.style.display = 'none';
      }
  }
});

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    updateSelectedPackage(); 
});