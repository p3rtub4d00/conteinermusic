const socket = io();

// --- Elementos da DOM (Mantidos iguais) ---
const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const selectedList = document.getElementById('selected');
const countSpan = document.getElementById('count');
const pagarBtn = document.getElementById('pagarBtn');
const pixArea = document.getElementById('pixArea');
const pixTitle = document.getElementById('pixTitle');
const qrCodeImg = document.getElementById('qrCode');
const copiaColaWrapper = pixArea?.querySelector('.copia-cola-wrapper');
const copiaColaText = document.getElementById('copiaCola');
const copyPixBtn = document.getElementById('copyPixBtn');
const paymentStatusMsg = document.getElementById('paymentStatusMsg');
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

// [NOVO] Elementos de Reação
const reactBtns = document.querySelectorAll('.react-btn');

// --- Estado Global ---
let selectedPackage = { limit: 3, price: 2.00, description: "Pacote 3 Músicas" };
let selectedVideos = [];
let finalAmount = 0;
let finalDescription = "";
let finalMessage = null;
let resetTimeoutId = null;

// --- ✨ Toastify Helper ---
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
        style: { background: backgroundColor, borderRadius: "10px", fontSize: "1rem" },
    }).showToast();
}

// [NOVO] Lógica dos Botões de Reação
if (reactBtns) {
    reactBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.getAttribute('data-emoji');
            if (emoji && socket) {
                // Envia para o servidor
                socket.emit('reaction', emoji);
                // Feedback visual de clique (animação rápida)
                btn.style.transform = 'scale(1.2)';
                setTimeout(() => btn.style.transform = 'scale(1)', 150);
                showToast(`Reação enviada! ${emoji}`, 'success');
            }
        });
    });
}


// --- Funções Auxiliares (Pacotes, Busca, etc.) ---

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
        showToast(`Pacote alterado. Excesso de músicas removido.`, 'info');
    }
    updatePaymentButtonText();
    atualizarLista();
}

function updatePaymentButtonText() {
    if (!pagarBtn) return;
    pagarBtn.textContent = `Pagar R$ ${selectedPackage.price.toFixed(2).replace('.', ',')} (PIX)`;
    const canPay = selectedVideos.length === selectedPackage.limit;
    pagarBtn.disabled = !canPay;
}

// Função de Busca
async function buscarVideos() {
  if (!searchInput || !resultsDiv) return;

  const q = searchInput.value.trim();
  if (!q) return showToast('Digite o nome de uma música ou artista!', 'error');

  resultsDiv.innerHTML = '<p style="color:white; text-align:center">Buscando...</p>';
  if (pixArea) pixArea.style.display = 'none';

  try {
      const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Erro na rede: ${res.statusText}`);
      const data = await res.json();

      if (!data.ok || !data.results || data.results.length === 0) {
         resultsDiv.innerHTML = '<p style="color:white; text-align:center">Nenhum resultado encontrado.</p>';
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
              <img src="${v.thumbnail || ''}" alt=""> <div class="info">
                <strong>${v.title || 'Título Indisponível'}</strong><br> <small>${v.channel || 'Canal Indisponível'}</small><br> <button class="select-btn" onclick="addVideo('${v.id}', '${(v.title || '').replace(/'/g, "\\'")}')" ${buttonDisabled}>
                  ${buttonText}
                </button>
              </div>
            </div>
          `;
        })
        .join('');
  } catch (error) {
      console.error("Erro ao buscar vídeos:", error);
      resultsDiv.innerHTML = '<p style="color:white; text-align:center">Erro ao buscar. Tente novamente.</p>';
      showToast('Erro ao conectar com o servidor de busca.', 'error');
  }
}

// Adiciona Vídeo
window.addVideo = (id, title) => {
  if (!id || !title) return;
  if (selectedVideos.find(v => v.id === id)) return;
  
  if (selectedVideos.length >= selectedPackage.limit) {
    return showToast(`Limite de ${selectedPackage.limit} músicas atingido! Remova uma para adicionar outra.`, 'error');
  }

  selectedVideos.push({ id, title });
  atualizarLista();
  showToast('Música adicionada!', 'success');

  if (resultsDiv) {
      const card = resultsDiv.querySelector(`.video-item[data-video-id="${id}"]`);
      if (card) {
          card.classList.add('selected-video');
          const button = card.querySelector('.select-btn');
          if (button) { button.textContent = 'Selecionado ✓'; button.disabled = true; }
      }
  }
};

function atualizarLista() {
  if (selectedList) {
      selectedList.innerHTML = selectedVideos
        .map(v => `<li>${v.title} <button onclick="removerVideo('${v.id}')">❌</button></li>`)
        .join('');
  }
  if (countSpan) countSpan.textContent = selectedVideos.length;
  updatePaymentButtonText();
}

window.removerVideo = id => {
  selectedVideos = selectedVideos.filter(v => v.id !== id);
  atualizarLista();
  
  if (resultsDiv) {
      const card = resultsDiv.querySelector(`.video-item[data-video-id="${id}"]`);
       if (card) {
          card.classList.remove('selected-video');
          const button = card.querySelector('.select-btn');
          if (button) { button.textContent = 'Selecionar'; button.disabled = false; }
      }
  }
};

function resetUI() {
  selectedVideos = [];
  atualizarLista();
  if (pixArea) pixArea.style.display = 'none';
  if (resultsDiv) resultsDiv.innerHTML = '';
  if (searchInput) searchInput.value = '';
  if (messageModal) messageModal.style.display = 'none';

  if(pixTitle) pixTitle.textContent = "Faça o PIX";
  if(qrCodeImg) qrCodeImg.style.display = 'block';
  if(copiaColaWrapper) copiaColaWrapper.style.display = 'block';
  if(paymentStatusMsg) {
      paymentStatusMsg.style.display = 'none';
      paymentStatusMsg.className = '';
  }
   if(copyPixBtn) {
      copyPixBtn.textContent = 'Copiar Código';
      copyPixBtn.classList.remove('copied');
      copyPixBtn.disabled = false;
      copyPixBtn.style.display = 'inline-block';
  }
  if(resetTimeoutId) { clearTimeout(resetTimeoutId); resetTimeoutId = null; }
}

// Processar Pagamento
async function proceedToPayment() {
  if(pagarBtn) pagarBtn.disabled = true;

  if (!socket || !socket.id) {
      showToast("Erro de conexão. Aguarde um momento e tente novamente.", 'error');
      updatePaymentButtonText();
      return;
  }

  const videos = selectedVideos;

  try {
      const res = await fetch('/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: videos,
          amount: finalAmount,
          description: finalDescription,
          message: finalMessage,
          socketId: socket.id
        })
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Erro ${res.status}`);
      }

      if (pixArea) pixArea.style.display = 'block';
      if(qrCodeImg) qrCodeImg.src = `data:image/png;base64,${data.qr}`;
      if(copiaColaText) copiaColaText.value = data.copiaCola;

      // Reset visual área pix
      if(pixTitle) pixTitle.textContent = "Faça o PIX";
      if(qrCodeImg) qrCodeImg.style.display = 'block';
      if(copiaColaWrapper) copiaColaWrapper.style.display = 'block';
      if(paymentStatusMsg) paymentStatusMsg.style.display = 'none';
      if(copyPixBtn) {
          copyPixBtn.textContent = 'Copiar Código';
          copyPixBtn.classList.remove('copied');
          copyPixBtn.disabled = false;
          copyPixBtn.style.display = 'inline-block';
      }

      selectedVideos = [];
      atualizarLista();
      showToast("QR Code gerado! Aguardando pagamento...", 'success');

  } catch (error) {
       console.error("Erro pagamento:", error);
       showToast(`Erro ao gerar PIX: ${error.message}`, 'error');
       updatePaymentButtonText();
  }
}

// --- Event Listeners ---

if (searchBtn) searchBtn.addEventListener('click', buscarVideos);

if (packageRadios) {
    packageRadios.forEach(radio => {
      radio.addEventListener('change', updateSelectedPackage);
    });
}

if (pagarBtn) {
    pagarBtn.addEventListener('click', () => {
      if (selectedVideos.length !== selectedPackage.limit) return;
      if (!messageModal) return;

      if(modalInitialButtons) modalInitialButtons.style.display = 'flex';
      if(modalMessageInputArea) modalMessageInputArea.style.display = 'none';
      if(modalMessageText) modalMessageText.value = '';
      finalMessage = null;
      finalAmount = selectedPackage.price;
      finalDescription = selectedPackage.description;

      messageModal.style.display = 'flex';
    });
}

if (modalBtnNo) {
    modalBtnNo.addEventListener('click', () => {
      if(messageModal) messageModal.style.display = 'none';
      proceedToPayment();
    });
}

if (modalBtnYes) {
    modalBtnYes.addEventListener('click', () => {
      if(modalInitialButtons) modalInitialButtons.style.display = 'none';
      if(modalMessageInputArea) modalMessageInputArea.style.display = 'block';
      finalAmount = selectedPackage.price + MESSAGE_COST;
      finalDescription = selectedPackage.description + " + Mensagem";
      if(modalBtnConfirm) modalBtnConfirm.textContent = `Confirmar e Pagar R$ ${finalAmount.toFixed(2).replace('.', ',')}`;
      if(modalMessageText) modalMessageText.focus();
    });
}

if (modalBtnConfirm) {
    modalBtnConfirm.addEventListener('click', () => {
      if(modalMessageText) finalMessage = modalMessageText.value.trim();
      if(messageModal) messageModal.style.display = 'none';
      proceedToPayment();
    });
}

if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      if(messageModal) messageModal.style.display = 'none';
    });
}

if (messageModal) {
    messageModal.addEventListener('click', (e) => {
      if (e.target === messageModal) {
        messageModal.style.display = 'none';
      }
    });
}

if (copyPixBtn) {
    copyPixBtn.addEventListener('click', () => {
        if (!copiaColaText) return;
        copiaColaText.select();
        copiaColaText.setSelectionRange(0, 99999);

        navigator.clipboard.writeText(copiaColaText.value).then(() => {
            copyPixBtn.textContent = 'Copiado ✓';
            copyPixBtn.classList.add('copied');
            copyPixBtn.disabled = true;
            showToast("Código PIX copiado!", 'success');
            setTimeout(() => {
                if (copyPixBtn && copyPixBtn.classList.contains('copied')) {
                    copyPixBtn.textContent = 'Copiar Código';
                    copyPixBtn.classList.remove('copied');
                    copyPixBtn.disabled = false;
                }
            }, 2000);
        }, (err) => {
            showToast('Erro ao copiar automaticamente. Copie manualmente.', 'error');
        });
    });
}

// --- Listeners Socket.io ---
socket.on('connect', () => console.log('Conectado:', socket.id));

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

socket.on('paymentConfirmed', () => {
    if (pixArea && paymentStatusMsg) {
        if(qrCodeImg) qrCodeImg.style.display = 'none';
        if(copiaColaWrapper) copiaColaWrapper.style.display = 'none';
        if(copyPixBtn) copyPixBtn.style.display = 'none';

        if(pixTitle) pixTitle.textContent = "Obrigado!";
        paymentStatusMsg.textContent = "Pagamento Aprovado! Suas músicas entrarão na fila.";
        paymentStatusMsg.className = 'success';
        paymentStatusMsg.style.display = 'block';
        pixArea.style.display = 'block';
        
        showToast("Pagamento Confirmado! Divirta-se!", 'success');

        if(resetTimeoutId) clearTimeout(resetTimeoutId);

        resetTimeoutId = setTimeout(() => {
            resetUI();
            resetTimeoutId = null;
        }, 5000);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    updateSelectedPackage();
});
