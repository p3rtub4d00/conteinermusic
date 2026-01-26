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

// TTS (Texto para Fala)
const synth = window.speechSynthesis;

// 1. API do YouTube Ready
function onYouTubeIframeAPIReady() {
  console.log("[Player.js] API do Iframe do YouTube está pronta.");
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

// 2. Player Ready
function onPlayerReady(event) {
  console.log('[Player.js] Player pronto!');
  isPlayerReady = true;
  player.mute(); // Começa mudo para evitar bloqueio de autoplay

  socket.emit('player:ready');

  if (pendingVideo) {
    playVideo(pendingVideo);
    pendingVideo = null;
  }
}

// 3. Mudança de Estado
function onPlayerStateChange(event) {
  // Limpa timer se pausar ou acabar
  if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
    if (currentVideoTimer) {
      clearTimeout(currentVideoTimer);
      currentVideoTimer = null;
    }
  }

  // Se estiver tocando
  if (event.data === YT.PlayerState.PLAYING) {
    if (!currentVideoTimer) {
      currentVideoTimer = setTimeout(() => {
        console.log(`[Player.js] Timeout de ${MAX_PLAYBACK_TIME}ms atingido.`);
        currentVideoTimer = null;
        socket.emit('player:videoEnded');
      }, MAX_PLAYBACK_TIME);
    }
  }
  // Se acabou
  else if (event.data === YT.PlayerState.ENDED) {
      if (synth && synth.speaking) synth.cancel();
      if (currentVideoTimer) {
          clearTimeout(currentVideoTimer);
          currentVideoTimer = null;
      }
      socket.emit('player:videoEnded');
  }
}

// Tratamento de Erro
function onPlayerError(event) {
    console.error('[Player.js] Erro no player:', event.data);
    if (synth && synth.speaking) synth.cancel();
    if (currentVideoTimer) {
        clearTimeout(currentVideoTimer);
        currentVideoTimer = null;
    }
    socket.emit('player:videoEnded');
}

// --- Socket Events ---

socket.on('connect', () => console.log('[Player.js] Conectado ao servidor'));

// [NOVO] Recebe a fila atualizada e mostra na tela
socket.on('updatePlayerState', (state) => {
    if (state && state.queue) {
        updateQueueDisplay(state.queue);
    }
});

function updateQueueDisplay(queue) {
    if (!queueList || !queueOverlay) return;

    // Se fila vazia, esconde
    if (queue.length === 0) {
        queueOverlay.style.display = 'none';
        return;
    }

    // Mostra a caixa
    queueOverlay.style.display = 'block';
    
    // Pega apenas as próximas 5 músicas para não poluir a tela
    const nextSongs = queue.slice(0, 5);

    queueList.innerHTML = nextSongs.map((video, index) => {
        const cssClass = video.isCustomer ? 'is-customer' : '';
        return `
            <li class="${cssClass}">
                <span class="song-number">${index + 1}.</span>
                <span class="song-title">${video.title}</span>
            </li>
        `;
    }).join('');
}

// Tocar Vídeo
socket.on('player:playVideo', ({ videoId, title, message }) => {
  const videoInfo = { videoId, title, message };

  if (isPlayerReady) {
    playVideo(videoInfo);
  } else {
    pendingVideo = videoInfo;
  }
});

// Atualiza Texto Promo
socket.on('player:updatePromoText', (text) => {
  if (promoBannerElement && promoTextContentElement) {
    promoTextContentElement.textContent = text;
    // Reinicia animação CSS forçando reflow
    promoBannerElement.classList.remove('scrolling');
    void promoBannerElement.offsetWidth; 
    
    if (promoTextContentElement.scrollWidth > promoBannerElement.clientWidth) {
         promoBannerElement.classList.add('scrolling');
    }
  }
});

// Comandos de Controle
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


// Função Principal de Play
function playVideo({ videoId, title, message }) {
  if (!isPlayerReady) return;

  if (synth && synth.speaking) synth.cancel();
  if (currentVideoTimer) {
    clearTimeout(currentVideoTimer);
    currentVideoTimer = null;
  }
  
  // Para o vídeo anterior antes de carregar o novo
  try { player.stopVideo(); } catch(e){}

  const loadAndPlayVideo = () => {
    player.loadVideoById(videoId);
  };

  // Lógica de Mensagem Falada (TTS)
  if (message && message.trim().length > 0 && synth) {
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.0; 

    let speechTimeout = null;

    utterance.onend = () => {
      if (speechTimeout) clearTimeout(speechTimeout);
      loadAndPlayVideo();
    };

    utterance.onerror = () => {
      if (speechTimeout) clearTimeout(speechTimeout);
      loadAndPlayVideo();
    };

    try {
        synth.cancel();
        setTimeout(() => {
            synth.speak(utterance);
            // Timer de segurança de 20s
            speechTimeout = setTimeout(() => {
                synth.cancel();
                loadAndPlayVideo();
            }, 20000); 
        }, 100);
    } catch (e) {
        loadAndPlayVideo();
    }
  } else {
    loadAndPlayVideo();
  }
}

// Ping para manter servidor ativo
setInterval(() => {
    if (socket && socket.connected) {
        socket.emit('player:ping');
    }
}, 5 * 60 * 1000);
