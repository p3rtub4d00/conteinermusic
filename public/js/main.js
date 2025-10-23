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
const pixTitle = document.getElementById('pixTitle'); // Título da área PIX
const qrCodeImg = document.getElementById('qrCode');
const copiaColaWrapper = pixArea?.querySelector('.copia-cola-wrapper'); // Wrapper do copia e cola (Usa optional chaining)
const copiaColaText = document.getElementById('copiaCola');
const copyPixBtn = document.getElementById('copyPixBtn'); // Botão Copiar
const paymentStatusMsg = document.getElementById('paymentStatusMsg'); // Parágrafo para status
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
let resetTimeoutId = null; // ID do timeout para resetar a UI

// --- Funções Auxiliares ---

function updateSelectedPackage() {
    const checkedRadio = document.querySelector('input[name="package"]:checked');
    if (!checkedRadio) return;
    selectedPackage.limit = parseInt(checkedRadio.dataset.limit, 10);
    selectedPackage.price = parseFloat(checkedRadio.dataset.price);
    selectedPackage.description = `Pacote ${selectedPackage.limit} Músicas`;

    if (limitSpan) limitSpan.textContent = selectedPackage.limit;

    // Remove vídeos excedentes se o limite diminuiu
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

// Função de Busca
async function buscarVideos() {
  if (!searchInput || !resultsDiv) return;

  const q = searchInput.value.trim();
  if (!q) return alert('Digite algo para buscar!');

  resultsDiv.innerHTML = '<p>Buscando...</p>';
  if (pixArea) pixArea.style.display = 'none'; // Esconde PIX se estava visível

  try {
      const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Erro na rede: ${res.statusText}`);
      const data = await res.json();

      if (!data.ok) {
        resultsDiv.innerHTML = '<p>Erro na busca!</p>';
        return;
      }

      if (!data.results || data.results.length === 0) {
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
              <img src="${v.thumbnail || ''}" alt="">
              <div class="info">
                <strong>${v.title || 'Título Indisponível'}</strong><br>
                <small>${v.channel || 'Canal Indisponível'}</small><br>
                <button class="select-btn" onclick="addVideo('${v.id}', '${(v.title || '').replace(/'/g, "\\'")}')" ${buttonDisabled}>
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

// Adiciona Vídeo
window.addVideo = (id, title) => {
  if (!id || !title) return;
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

// Atualiza a lista lateral
function atualizarLista() {
  if (selectedList) {
      selectedList.innerHTML = selectedVideos
        .map(v => `<li>${v.title} <button onclick="removerVideo('${v.id}')">❌</button></li>`)
        .join('');
  }
  if (countSpan) countSpan.textContent = selectedVideos.length;
  updatePaymentButtonText(); // Atualiza estado dos botões Pagar/Simular
}

// Remove Vídeo
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

// Função para resetar a UI
function resetUI() {
  console.log("[main.js] Chamando resetUI()...");
  selectedVideos = [];
  atualizarLista(); // Limpa lista lateral e desabilita botões
  if (pixArea) pixArea.style.display = 'none'; // Esconde PIX
  if (resultsDiv) resultsDiv.innerHTML = ''; // Limpa resultados da busca
  if (searchInput) searchInput.value = ''; // Limpa campo de busca
  if (messageModal) messageModal.style.display = 'none'; // Garante que modal fecha

  // Reseta a área PIX para o estado original
  if(pixTitle) pixTitle.textContent = "Faça o PIX";
  if(qrCodeImg) qrCodeImg.style.display = 'block'; // Mostra QR Code de volta
  if(copiaColaWrapper) copiaColaWrapper.style.display = 'block'; // Mostra Copia/Cola de volta
  if(paymentStatusMsg) {
      paymentStatusMsg.style.display = 'none';
      paymentStatusMsg.className = ''; // Remove classes de success/error
  }
   if(copyPixBtn) { // Reseta botão copiar
      copyPixBtn.textContent = 'Copiar Código';
      copyPixBtn.classList.remove('copied');
      copyPixBtn.disabled = false;
  }
  // Cancela qualquer timeout de reset pendente
  if(resetTimeoutId) {
      clearTimeout(resetTimeoutId);
      resetTimeoutId = null;
  }
  console.log("[main.js] resetUI() finalizado.");
}

// Função que processa o pagamento
async function proceedToPayment() {
  if(pagarBtn) pagarBtn.disabled = true;
  if(simularBtn) simularBtn.disabled = true;

  const videos = selectedVideos;

  console.log("[main.js] Enviando para pagamento:", { videos, amount: finalAmount, description: finalDescription, message: finalMessage, socketId: socket.id });

  try {
      const res = await fetch('/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: videos,
          amount: finalAmount,
          description: finalDescription,
          message: finalMessage,
          socketId: socket.id // Envia o ID do socket
        })
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Erro ${res.status}: ${res.statusText}`);
      }

      // Mostra a área do PIX (já no estado resetado pelo resetUI anterior, se houve)
      if(pixTitle) pixTitle.textContent = "Faça o PIX";
      if(qrCodeImg) { qrCodeImg.src = `data:image/png;base64,${data.qr}`; qrCodeImg.style.display = 'block'; }
      if(copiaColaText) copiaColaText.value = data.copiaCola;
      if(copyPixBtn) { // Reseta botão copiar
          copyPixBtn.textContent = 'Copiar Código';
          copyPixBtn.classList.remove('copied');
          copyPixBtn.disabled = false;
      }
      if(copiaColaWrapper) copiaColaWrapper.style.display = 'block';
      if(paymentStatusMsg) paymentStatusMsg.style.display = 'none'; // Esconde msg de status
      if (pixArea) pixArea.style.display = 'block'; // Mostra a área

      // Apenas limpa a seleção atual e desabilita botões Pagar/Simular
      selectedVideos = [];
      atualizarLista();

  } catch (error) {
       console.error("[main.js] Erro detalhado ao gerar pagamento:", error);
       alert(`Erro ao gerar pagamento: ${error.message}`);
       updatePaymentButtonText(); // Reabilita botões se falhar
  }
}

// --- Event Listeners ---

// Listener Botão Buscar
if (searchBtn) {
    searchBtn.addEventListener('click', buscarVideos);
} else {
    console.error("Erro crítico: Botão 'Buscar' (searchBtn) não encontrado!");
}

// Listener Pacotes
if (packageRadios) {
    packageRadios.forEach(radio => {
      radio.addEventListener('change', updateSelectedPackage);
    });
} else {
    console.error("Erro: Seletores de pacote (packageRadios) não encontrados!");
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

// Listener de Simulação (Chama resetUI)
if (simularBtn) {
    simularBtn.addEventListener('click', () => {
      const videos = selectedVideos;
      if (videos.length === 0) return;

      socket.emit('simulatePlay', {
        videos: videos,
        message: null // Simulação não inclui mensagem
      });

      resetUI(); // Reset é OK aqui na simulação
    });
} else { console.error("Botão simularBtn não encontrado!"); }


// Listener para o Botão Copiar PIX
if (copyPixBtn) {
    copyPixBtn.addEventListener('click', () => {
        if (!copiaColaText) return;

        copiaColaText.select(); // Seleciona o texto
        copiaColaText.setSelectionRange(0, 99999); // Para mobile

        try {
            navigator.clipboard.writeText(copiaColaText.value).then(() => {
                console.log('Código PIX copiado!');
                copyPixBtn.textContent = 'Copiado ✓';
                copyPixBtn.classList.add('copied');
                copyPixBtn.disabled = true;
                setTimeout(() => {
                    copyPixBtn.textContent = 'Copiar Código';
                    copyPixBtn.classList.remove('copied');
                    copyPixBtn.disabled = false;
                }, 2000);
            }, (err) => {
                console.error('Falha ao copiar (API moderna): ', err);
                alert('Não foi possível copiar o código. Tente manualmente.');
            });
        } catch (err) {
            console.error('Falha ao copiar (Catch): ', err);
            // Fallback (menos confiável) - Removido por simplicidade, focar na API moderna
             alert('Não foi possível copiar o código automaticamente. Por favor, copie manualmente.');
        }
    });
} else {
    console.warn("Botão 'Copiar Código' (copyPixBtn) não encontrado.");
}


// --- Listeners Socket.io ---
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

// Listener para Confirmação de Pagamento
socket.on('paymentConfirmed', () => {
    console.log('[main.js] Recebido evento paymentConfirmed do servidor!');
    if (pixArea && paymentStatusMsg) {
        // Esconde QR code e Copia/Cola
        if(qrCodeImg) qrCodeImg.style.display = 'none';
        if(copiaColaWrapper) copiaColaWrapper.style.display = 'none';
        if(copyPixBtn) copyPixBtn.style.display = 'none'; // Esconde botão copiar também

        // Mostra mensagem de sucesso
        if(pixTitle) pixTitle.textContent = "Obrigado!";
        paymentStatusMsg.textContent = "Pagamento Aprovado! Suas músicas entrarão na fila.";
        paymentStatusMsg.className = 'success'; // Adiciona classe para estilo
        paymentStatusMsg.style.display = 'block';
        pixArea.style.display = 'block'; // Garante que a área está visível

        // Cancela qualquer timeout de reset anterior (segurança)
        if(resetTimeoutId) {
            clearTimeout(resetTimeoutId);
        }

        // Reseta a UI completamente após um delay
        resetTimeoutId = setTimeout(() => {
            console.log('[main.js] Delay finalizado, chamando resetUI() após confirmação.');
            resetUI();
            resetTimeoutId = null; // Limpa o ID do timeout
        }, 3000); // 3 segundos
    } else {
        console.error("Erro: Elementos da área PIX não encontrados para mostrar confirmação.");
    }
});


// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("[main.js] DOM carregado. Inicializando UI.");
    updateSelectedPackage();
});
