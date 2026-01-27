const socket = io();

// --- Elementos DOM ---
const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const selectedList = document.getElementById('selected');
const countSpan = document.getElementById('count');
const pagarBtn = document.getElementById('pagarBtn');
const pixArea = document.getElementById('pixArea');
const pixTitle = document.getElementById('pixTitle');
const qrCodeImg = document.getElementById('qrCode');
const copiaColaWrapper = document.querySelector('.copia-cola-wrapper'); // Seletor corrigido
const copiaColaText = document.getElementById('copiaCola');
const copyPixBtn = document.getElementById('copyPixBtn');
const paymentStatusMsg = document.getElementById('paymentStatusMsg');
const nowPlayingArea = document.getElementById('now-playing-area');
const nowPlayingTitleSpan = document.getElementById('nowPlayingTitle');
const packageRadios = document.querySelectorAll('input[name="package"]');
const limitSpan = document.getElementById('limit');

// Modal Mensagem
const messageModal = document.getElementById('messageModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalBtnYes = document.getElementById('modalBtnYes');
const modalBtnNo = document.getElementById('modalBtnNo');
const modalInitialButtons = document.getElementById('modalInitialButtons');
const modalMessageInputArea = document.getElementById('modalMessageInputArea');
const modalMessageText = document.getElementById('modalMessageText');
const modalBtnConfirm = document.getElementById('modalBtnConfirm');
const MESSAGE_COST = 1.00;

// Reações
const reactBtns = document.querySelectorAll('.react-btn');

// --- Elementos de Login e Perfil ---
const navHome = document.getElementById('nav-home');
const navUser = document.getElementById('nav-user');
const homeArea = document.getElementById('home-area');
const userProfileArea = document.getElementById('user-profile-area');
const loginModal = document.getElementById('loginModal');
const userPhoneInput = document.getElementById('userPhoneInput');
const btnConfirmLogin = document.getElementById('btnConfirmLogin');
const loginCloseBtn = document.getElementById('loginCloseBtn');
const userPhoneDisplay = document.getElementById('user-phone-display');
const historyList = document.getElementById('history-list');
const historyLoading = document.getElementById('history-loading');
const logoutBtn = document.getElementById('logoutBtn');
const backToHomeBtn = document.getElementById('backToHomeBtn');

// --- Estado Global ---
let selectedPackage = { limit: 3, price: 2.00, description: "Pacote 3 Músicas" };
let selectedVideos = [];
let finalAmount = 0;
let finalDescription = "";
let finalMessage = null;
let currentUserPhone = localStorage.getItem('userPhone');

// --- Toastify Helper ---
function showToast(message, type = 'info') {
    let backgroundColor;
    if (type === 'error') backgroundColor = "linear-gradient(to right, #b71c1c, #d32f2f)";
    else if (type === 'success') backgroundColor = "linear-gradient(to right, #1b5e20, #2e7d32)";
    else backgroundColor = "linear-gradient(to right, #333, #555)";

    Toastify({
        text: message,
        duration: 3000,
        close: true,
        gravity: "top", 
        position: "center", 
        style: { background: backgroundColor, borderRadius: "8px", fontSize: "1rem", fontWeight: "600" },
    }).showToast();
}

// --- Funções de Reset (CORRIGIDO) ---
function resetUI() {
  console.log('Resetando interface...');
  
  // 1. Limpa dados
  selectedVideos = [];
  atualizarLista();
  
  // 2. Esconde Área do PIX
  if (pixArea) pixArea.style.display = 'none';

  // 3. Reseta o visual interno do PIX para a próxima vez
  if (qrCodeImg) qrCodeImg.style.display = 'block';
  if (copiaColaWrapper) copiaColaWrapper.style.display = 'block';
  if (pixTitle) pixTitle.textContent = "Faça o PIX";
  if (paymentStatusMsg) {
      paymentStatusMsg.style.display = 'none';
      paymentStatusMsg.textContent = '';
  }

  // 4. Limpa busca
  if (resultsDiv) resultsDiv.innerHTML = '';
  if (searchInput) searchInput.value = '';

  // 5. Reseta botão de copiar
  if(copyPixBtn) { 
      copyPixBtn.textContent = 'COPIAR CÓDIGO'; 
      copyPixBtn.classList.remove('copied'); 
      copyPixBtn.disabled = false; 
  }

  // 6. Garante que botão de pagar resete
  if(pagarBtn) pagarBtn.disabled = true;
}


// --- Navegação e Perfil ---
function showHome() {
    homeArea.style.display = 'block';
    userProfileArea.style.display = 'none';
    navHome.classList.add('active');
    navUser.classList.remove('active');
}

function showProfile() {
    if (!currentUserPhone) {
        loginModal.style.display = 'flex';
        return;
    }
    homeArea.style.display = 'none';
    userProfileArea.style.display = 'block';
    navHome.classList.remove('active');
    navUser.classList.add('active');
    userPhoneDisplay.textContent = `Logado como: ${currentUserPhone}`;
    loadUserHistory();
}

navHome.addEventListener('click', (e) => { e.preventDefault(); showHome(); });
navUser.addEventListener('click', (e) => { e.preventDefault(); showProfile(); });
if(backToHomeBtn) backToHomeBtn.addEventListener('click', showHome);

btnConfirmLogin.addEventListener('click', () => {
    const phone = userPhoneInput.value.trim();
    if (phone.length < 8) return showToast('Digite um telefone válido!', 'error');
    currentUserPhone = phone;
    localStorage.setItem('userPhone', phone);
    loginModal.style.display = 'none';
    showProfile();
    showToast('Login realizado!', 'success');
});

if(loginCloseBtn) loginCloseBtn.addEventListener('click', () => loginModal.style.display = 'none');
if(logoutBtn) logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('userPhone');
    currentUserPhone = null;
    showHome();
    showToast('Você saiu do perfil.', 'info');
});

async function loadUserHistory() {
    if (!currentUserPhone) return;
    historyList.innerHTML = '';
    historyLoading.style.display = 'block';
    try {
        const res = await fetch(`/user-history?phone=${encodeURIComponent(currentUserPhone)}`);
        const data = await res.json();
        historyLoading.style.display = 'none';
        if (!data.ok || !data.history || data.history.length === 0) {
            historyList.innerHTML = '<p style="color:#888; text-align:center;">Você ainda não fez pedidos.</p>';
            return;
        }
        historyList.innerHTML = data.history.map(v => `
            <div class="video-item">
                <img src="${v.thumbnail}" alt="thumb">
                <div class="info">
                    <strong>${v.title}</strong>
                    <button class="select-btn" onclick="addVideo('${v.id}', '${(v.title || '').replace(/'/g, "\\'")}')">
                       ADICIONAR
                    </button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        historyLoading.style.display = 'none';
        historyList.innerHTML = '<p style="color:red">Erro ao carregar histórico.</p>';
    }
}

// --- Reações ---
if (reactBtns) {
    reactBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.getAttribute('data-emoji');
            if (emoji && socket) {
                socket.emit('reaction', emoji);
                btn.style.transform = 'scale(1.2)';
                setTimeout(() => btn.style.transform = 'scale(1)', 150);
                showToast(`Enviado! ${emoji}`, 'success');
            }
        });
    });
}

// --- Funções Principais ---
function updateSelectedPackage() {
    const checkedRadio = document.querySelector('input[name="package"]:checked');
    if (!checkedRadio) return;
    selectedPackage.limit = parseInt(checkedRadio.dataset.limit, 10);
    selectedPackage.price = parseFloat(checkedRadio.dataset.price);
    selectedPackage.description = `Pacote ${selectedPackage.limit} Músicas`;
    if (limitSpan) limitSpan.textContent = selectedPackage.limit;
    if (selectedVideos.length > selectedPackage.limit) {
        selectedVideos.splice(selectedPackage.limit);
        atualizarLista();
        showToast(`Pacote alterado. Limite ajustado.`, 'info');
    }
    updatePaymentButtonText();
    atualizarLista();
}

function updatePaymentButtonText() {
    if (!pagarBtn) return;
    pagarBtn.textContent = `PAGAR R$ ${selectedPackage.price.toFixed(2).replace('.', ',')} (PIX)`;
    const canPay = selectedVideos.length === selectedPackage.limit;
    pagarBtn.disabled = !canPay;
}

async function buscarVideos() {
  if (!searchInput || !resultsDiv) return;
  const q = searchInput.value.trim();
  if (!q) return showToast('Digite o nome de uma música!', 'error');
  resultsDiv.innerHTML = '<p style="color:#888; text-align:center">Buscando...</p>';
  if (pixArea) pixArea.style.display = 'none';
  try {
      const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.ok || !data.results || data.results.length === 0) {
         resultsDiv.innerHTML = '<p style="color:#888; text-align:center">Nada encontrado.</p>';
         return;
      }
      const selectedIds = selectedVideos.map(v => v.id);
      resultsDiv.innerHTML = data.results.map( v => {
          const isSelected = selectedIds.includes(v.id);
          const buttonText = isSelected ? 'NA LISTA' : 'SELECIONAR';
          const buttonDisabled = isSelected ? 'disabled' : '';
          const cardClass = isSelected ? 'video-item selected-video' : 'video-item';
          return `
            <div class="${cardClass}" data-video-id="${v.id}">
              <img src="${v.thumbnail || ''}" alt=""> <div class="info">
                <strong>${v.title || 'Sem Título'}</strong>
                <button class="select-btn" onclick="addVideo('${v.id}', '${(v.title || '').replace(/'/g, "\\'")}')" ${buttonDisabled}>
                  ${buttonText}
                </button>
              </div>
            </div>
          `;
        }).join('');
  } catch (error) {
      resultsDiv.innerHTML = '<p style="color:red; text-align:center">Erro na busca.</p>';
  }
}

window.addVideo = (id, title) => {
  if (selectedVideos.find(v => v.id === id)) return showToast('Essa música já está na lista!', 'info');
  if (selectedVideos.length >= selectedPackage.limit) return showToast(`Limite de ${selectedPackage.limit} atingido!`, 'error');
  selectedVideos.push({ id, title });
  atualizarLista();
  showToast('Adicionada!', 'success');
  if (userProfileArea.style.display === 'block') showHome();
  const card = document.querySelector(`.video-item[data-video-id="${id}"]`);
  if (card) {
      card.classList.add('selected-video');
      const btn = card.querySelector('.select-btn');
      if(btn) { btn.textContent = 'NA LISTA'; btn.disabled = true; }
  }
};

function atualizarLista() {
  if (selectedList) {
      selectedList.innerHTML = selectedVideos
        .map(v => `<li><span>${v.title}</span> <button onclick="removerVideo('${v.id}')">❌</button></li>`)
        .join('');
  }
  if (countSpan) countSpan.textContent = selectedVideos.length;
  updatePaymentButtonText();
}

window.removerVideo = id => {
  selectedVideos = selectedVideos.filter(v => v.id !== id);
  atualizarLista();
  const card = document.querySelector(`.video-item[data-video-id="${id}"]`);
  if (card) {
      card.classList.remove('selected-video');
      const btn = card.querySelector('.select-btn');
      if(btn) { btn.textContent = 'SELECIONAR'; btn.disabled = false; }
  }
};

async function proceedToPayment() {
  if(pagarBtn) pagarBtn.disabled = true;
  try {
      const res = await fetch('/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: selectedVideos,
          amount: finalAmount,
          description: finalDescription,
          message: finalMessage,
          socketId: socket.id,
          userPhone: currentUserPhone || null
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      if (pixArea) pixArea.style.display = 'block';
      if(qrCodeImg) qrCodeImg.src = `data:image/png;base64,${data.qr}`;
      if(copiaColaText) copiaColaText.value = data.copiaCola;
      selectedVideos = [];
      atualizarLista();
      showToast("Pagamento gerado! Aguardando PIX...", 'success');
  } catch (error) {
       showToast(`Erro: ${error.message}`, 'error');
       updatePaymentButtonText();
  }
}

// Listeners
if (searchBtn) searchBtn.addEventListener('click', buscarVideos);
if (packageRadios) packageRadios.forEach(radio => radio.addEventListener('change', updateSelectedPackage));
if (pagarBtn) {
    pagarBtn.addEventListener('click', () => {
      if (selectedVideos.length !== selectedPackage.limit) return;
      if(messageModal) {
          modalInitialButtons.style.display = 'flex';
          modalMessageInputArea.style.display = 'none';
          modalMessageText.value = '';
          finalMessage = null;
          finalAmount = selectedPackage.price;
          finalDescription = selectedPackage.description;
          messageModal.style.display = 'flex';
      }
    });
}

if (modalBtnNo) modalBtnNo.addEventListener('click', () => { messageModal.style.display = 'none'; proceedToPayment(); });
if (modalBtnYes) modalBtnYes.addEventListener('click', () => {
      modalInitialButtons.style.display = 'none';
      modalMessageInputArea.style.display = 'block';
      finalAmount = selectedPackage.price + MESSAGE_COST;
      finalDescription = selectedPackage.description + " + Mensagem";
      modalBtnConfirm.textContent = `CONFIRMAR (R$ ${finalAmount.toFixed(2).replace('.', ',')})`;
});
if (modalBtnConfirm) modalBtnConfirm.addEventListener('click', () => {
      finalMessage = modalMessageText.value.trim();
      messageModal.style.display = 'none';
      proceedToPayment();
});
if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => messageModal.style.display = 'none');

if (copyPixBtn) {
    copyPixBtn.addEventListener('click', () => {
        if (!copiaColaText) return;
        copiaColaText.select();
        navigator.clipboard.writeText(copiaColaText.value).then(() => {
            copyPixBtn.textContent = 'Copiado!'; copyPixBtn.classList.add('copied'); copyPixBtn.disabled = true;
            showToast("Código copiado!", 'success');
        });
    });
}

// Socket Events
socket.on('connect', () => console.log('Socket Conectado'));
socket.on('updatePlayerState', (state) => {
  if (nowPlayingArea) {
      if (state.nowPlaying) {
        nowPlayingTitleSpan.textContent = state.nowPlaying.title;
        nowPlayingArea.style.display = 'flex';
      } else {
        nowPlayingArea.style.display = 'none';
      }
  }
});

// --- CONFIRMAÇÃO DE PAGAMENTO E RESET ---
socket.on('paymentConfirmed', () => {
    // Esconde os elementos do PIX
    if(qrCodeImg) qrCodeImg.style.display = 'none';
    if(copiaColaWrapper) copiaColaWrapper.style.display = 'none';
    
    // Mostra mensagem de sucesso
    if(pixTitle) pixTitle.textContent = "PAGAMENTO APROVADO!";
    if (paymentStatusMsg) {
        paymentStatusMsg.textContent = "Suas músicas estão na fila!";
        paymentStatusMsg.style.display = 'block';
        paymentStatusMsg.style.color = '#27ae60'; // Verde
    }
    
    showToast("Pagamento Confirmado!", 'success');
    
    // Aguarda 3 segundos e reseta a tela
    setTimeout(() => {
        resetUI();
    }, 3000);
});

document.addEventListener('DOMContentLoaded', updateSelectedPackage);
