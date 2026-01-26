const socket = io();
let player;
let isPlayerReady = false;

let currentVideoTimer = null;
const MAX_PLAYBACK_TIME = 5 * 60 * 1000; // 5 minutos

let pendingVideo = null;

// Elementos da Interface
const promoBannerElement = document.getElementById('promo-banner');
const promoTextContentElement = document.getElementById('promo-text-content');
const queueOverlay = document.getElementById('queue-overlay');
const queueList = document.getElementById('queue-list');
const qrImg = document.getElementById('qr-img');
const notificationPopup = document.getElementById('notification-popup');
const notifSongTitle = document.getElementById('notif-song-title');
const reactionContainer = document.getElementById('reaction-container'); // [NOVO]

// TTS REATIVADO
const synth = window.speechSynthesis;

// 🤖 CONFIGURAÇÃO DO BOT 🤖
const fakeSongs = [
    "Zé Neto & Cristiano - Oi Balde",
    "Gusttavo Lima - Termina Comigo Antes",
    "Marília Mendonça - Leão",
    "Henrique & Juliano - Traumatizei",
    "Jorge & Mateus - 5 Regras",
    "Ana Castela - Nosso Quadro",
    "Luan Santana - Meio Termo",
    "Simone Mendes - Erro Gostoso",
    "Israel & Rodolffo - Bombonzinho",
    "Matheus & Kauan - Pactos",
    "Zé Neto & Cristiano - Filha",
    "Gusttavo Lima - Bloqueado"
];

let botTimer = null;
const BOT_INTERVAL = 10 * 60 * 1000; // 10 Minutos

function resetBotTimer() {
    if (botTimer) clearTimeout(botTimer);
    console.log(`[Bot] Timer resetado.`);
    botTimer = setTimeout(triggerFakeOrder, BOT_INTERVAL);
}

function triggerFakeOrder() {
    const randomSong = fakeSongs[Math.floor(Math.random() * fakeSongs.length)];
    console.log(`[Bot] Disparando pedido falso: ${randomSong}`);
    showNotification(randomSong);
    resetBotTimer();
}

function showNotification(title) {
    if (!notificationPopup || !notifSongTitle) return;
    notifSongTitle.textContent = title;
    notificationPopup.classList.add('show');
    setTimeout(() => {
        notificationPopup.classList.remove('show');
    }, 5000);
}

// [NOVO] Função para criar Chuva de Emojis
function createReaction(emoji) {
    if (!reactionContainer) return;

    // Cria múltiplos elementos para parecer "chuva"
    const count = 5; // Quantidade de emojis por clique
    
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.classList.add('floating-emoji');
        el.textContent = emoji;

        // Posição horizontal aleatória (0 a 100%)
        const randomLeft = Math.random() * 100;
        el.style.left = `${randomLeft}%`;

        // Tamanho levemente variável
        const randomSize = 2 + Math.random() * 2; // entre 2rem e 4rem
        el.style.fontSize = `${randomSize}rem`;

        // Atraso aleatório para não subirem todos juntos
        const randomDelay = Math.random() * 0.5;
        el.style.animationDelay = `${randomDelay}s`;
        
        // Duração aleatória para velocidades diferentes
        const randomDuration = 3 + Math.random() * 2;
        el.style.animationDuration = `${randomDuration}s`;

        reactionContainer.appendChild(el);

        // Remove do DOM quando a animação acabar (4s + delay)
        setTimeout(() => {
            el.remove();
        }, (randomDuration + randomDelay) * 1000);
    }
}


// QR Code Generator
window.addEventListener('load', () => {
    if (qrImg) {
        const currentUrl = window.location.origin;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(currentUrl)}`;
        console.log(`[Player.js] QR Code gerado para: ${currentUrl}`);
    }
    resetBotTimer();
});


// YouTube API
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 1, controls: 1, rel: 0 },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
}

function onPlayerReady(event) {
  isPlayerReady = true;
  player.mute();
  socket.emit('player:ready');
  if (pendingVideo) {
    playVideo(pendingVideo);
    pendingVideo = null;
  }
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
    if (currentVideoTimer) {
      clearTimeout(currentVideoTimer);
      currentVideoTimer = null;
    }
  }
  if (event.data === YT.PlayerState.PLAYING) {
    if (!currentVideoTimer) {
      currentVideoTimer = setTimeout(() => {
        socket.emit('player:videoEnded');
      }, MAX_PLAYBACK_TIME);
    }
  }
  else if (event.data === YT.PlayerState.ENDED) {
      if (synth && synth.speaking) synth.cancel();
      if (currentVideoTimer) {
          clearTimeout(currentVideoTimer);
          currentVideoTimer = null;
      }
      socket.emit('player:videoEnded');
  }
}

function onPlayerError(event) {
    if (synth && synth.speaking) synth.cancel();
    if (currentVideoTimer) {
        clearTimeout(currentVideoTimer);
        currentVideoTimer = null;
    }
    socket.emit('player:videoEnded');
}

// Socket Events
socket.on('connect', () => console.log('[Player.js] Conectado ao servidor'));

socket.on('player:newOrderNotification', (data) => {
    showNotification(data.title);
    resetBotTimer();
});

// [NOVO] Recebe reação do servidor e desenha na tela
socket.on('player:showReaction', (emoji) => {
    createReaction(emoji);
});

socket.on('updatePlayerState', (state) => {
    if (state && state.queue) {
        updateQueueDisplay(state.queue);
    }
});

function updateQueueDisplay(queue) {
    if (!queueList || !queueOverlay) return;
    if (queue.length === 0) {
        queueOverlay.style.display = 'none';
        return;
    }
    queueOverlay.style.display = 'block';
    const nextSongs = queue.slice(0, 5);
    queueList.innerHTML = nextSongs.map((video, index) => {
        const cssClass = video.isCustomer ? 'is-customer' : '';
        return `<li class="${cssClass}"><span class="song-number">${index + 1}.</span><span class="song-title">${video.title}</span></li>`;
    }).join('');
}

socket.on('player:playVideo', ({ videoId, title, message }) => {
  const videoInfo = { videoId, title, message };
  if (isPlayerReady) {
    playVideo(videoInfo);
  } else {
    pendingVideo = videoInfo;
  }
});

socket.on('player:updatePromoText', (text) => {
  if (promoBannerElement && promoTextContentElement) {
    promoTextContentElement.textContent = text;
    promoBannerElement.classList.remove('scrolling');
    void promoBannerElement.offsetWidth; 
    if (promoTextContentElement.scrollWidth > promoBannerElement.clientWidth) {
         promoBannerElement.classList.add('scrolling');
    }
  }
});

socket.on('player:setInitialState', (data) => {
  if (!isPlayerReady) return;
  player.setVolume(data.volume);
  if (data.isMuted) player.mute(); else player.unMute();
});
socket.on('player:pause', () => {
  if (!isPlayerReady) return;
  const state = player.getPlayerState();
  if (state === YT.PlayerState.PLAYING) player.pauseVideo();
  else if (state === YT.PlayerState.PAUSED) player.playVideo();
});
socket.on('player:setVolume', (data) => {
  if (!isPlayerReady) return;
  player.setVolume(data.volume);
  if (data.isMuted) player.mute(); else player.unMute();
});

function playVideo({ videoId, title, message }) {
  if (!isPlayerReady) return;
  if (synth && synth.speaking) synth.cancel();
  if (currentVideoTimer) {
    clearTimeout(currentVideoTimer);
    currentVideoTimer = null;
  }
  try { player.stopVideo(); } catch(e){}

  const loadAndPlayVideo = () => player.loadVideoById(videoId);

  if (message && message.trim().length > 0 && synth) {
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.0; 
    let speechTimeout = null;

    utterance.onend = () => { if (speechTimeout) clearTimeout(speechTimeout); loadAndPlayVideo(); };
    utterance.onerror = () => { if (speechTimeout) clearTimeout(speechTimeout); loadAndPlayVideo(); };

    try {
        synth.cancel();
        setTimeout(() => {
            synth.speak(utterance);
            speechTimeout = setTimeout(() => {
                synth.cancel();
                loadAndPlayVideo();
            }, 20000); 
        }, 100);
    } catch (e) { loadAndPlayVideo(); }
  } else {
    loadAndPlayVideo();
  }
}

setInterval(() => {
    if (socket && socket.connected) socket.emit('player:ping');
}, 5 * 60 * 1000);
