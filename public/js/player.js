@@ -1,235 +1,236 @@
const socket = io();
let player;
let isPlayerReady = false;

let currentVideoTimer = null;
const MAX_PLAYBACK_TIME = 5 * 60 * 1000; // 5 minutos em milissegundos

let pendingVideo = null;

// Elementos da Faixa de Promoção
const promoBannerElement = document.getElementById('promo-banner');
const promoTextContentElement = document.getElementById('promo-text-content'); // Span interno

// TTS REATIVADO: Referência à API de Fala
const synth = window.speechSynthesis;


// 1. A API do YouTube chama esta função quando está pronta.
function onYouTubeIframeAPIReady() {
  console.log("[Player.js] API do Iframe do YouTube está pronta.");
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 1, controls: 1, rel: 0 },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange
    }
  });
}

// 2. Evento quando o *player* está pronto.
function onPlayerReady(event) {
  console.log('[Player.js] Evento onPlayerReady disparado!');
  isPlayerReady = true;
  player.mute(); // Muta inicialmente

  console.log('[Player.js] Enviando "player:ready" para o servidor.');
  socket.emit('player:ready');

  // Se houver um vídeo pendente (que chegou antes do player ficar pronto)
  if (pendingVideo) {
    console.log('[Player.js] Tocando vídeo pendente que chegou antes do player.');
    playVideo(pendingVideo);
    pendingVideo = null;
  } else {
    console.log('[Player.js] Nenhum vídeo pendente encontrado.');
  }
}

// 3. Evento de mudança de estado (lógica do timer)
function onPlayerStateChange(event) {
  console.log('[Player.js] Estado do player mudou:', event.data, YT.PlayerState);

  // Limpa o timer se o vídeo for pausado ou terminado
  if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
    if (currentVideoTimer) {
      console.log('[Player.js] Vídeo pausado ou terminado, limpando timer.');
      clearTimeout(currentVideoTimer);
      currentVideoTimer = null;
    }
  }

  // Se o vídeo está TOCANDO (estado 1)
  if (event.data === YT.PlayerState.PLAYING) {
    // Só inicia um novo timer se ele já não estiver rodando
    if (!currentVideoTimer) {
      console.log(`[Player.js] Iniciando timer de ${MAX_PLAYBACK_TIME / 60000} minutos para o vídeo.`);
      currentVideoTimer = setTimeout(() => {
        console.log(`[Player.js] Tempo limite de ${MAX_PLAYBACK_TIME / 60000} minutos atingido! Pulando...`);
        currentVideoTimer = null;
        socket.emit('player:videoEnded');
      }, MAX_PLAYBACK_TIME);
    }
  }
  // Se o vídeo TERMINOU (estado 0)
  else if (event.data === YT.PlayerState.ENDED) {
      console.log('[Player.js] Vídeo terminou, avisando o servidor.');
      if (synth && synth.speaking) synth.cancel();
      if (currentVideoTimer) {
          clearTimeout(currentVideoTimer);
          currentVideoTimer = null;
      }
      socket.emit('player:videoEnded');
  }
}

// 4. Ouve por comandos do servidor
socket.on('connect', () => console.log('[Player.js] Conectado ao servidor'));

// Evento único para tocar um vídeo (agora com 'message')
socket.on('player:playVideo', ({ videoId, title, message }) => {
  console.log('[Player.js] Recebido comando player:playVideo', { videoId, title, message });
  const videoInfo = { videoId, title, message }; // Guarda a mensagem

  if (isPlayerReady) {
    playVideo(videoInfo);
  } else {
    console.log('[Player.js] Comando de tocar recebido, mas player não está pronto. Armazenando.');
    pendingVideo = videoInfo;
  }
});

// Atualiza o texto da faixa de promoção e aplica animação se necessário
socket.on('player:updatePromoText', (text) => {
  if (promoBannerElement && promoTextContentElement) {
    promoTextContentElement.textContent = text;
    promoBannerElement.offsetHeight; // Força recalcular
    if (promoTextContentElement.scrollWidth > promoBannerElement.clientWidth) {
      if (!promoBannerElement.classList.contains('scrolling')) {
           console.log("[Player.js] Texto da promoção é longo. Ativando scroll.");
           promoBannerElement.classList.add('scrolling');
      }
    } else {
       if (promoBannerElement.classList.contains('scrolling')) {
           console.log("[Player.js] Texto da promoção cabe. Desativando scroll.");
           promoBannerElement.classList.remove('scrolling');
       }
    }
  }
});

// --- Comandos do Admin ---
socket.on('player:setInitialState', (data) => {
  if (!isPlayerReady) return;
  console.log('[Player.js] Recebendo estado inicial:', data);
  player.setVolume(data.volume);
  if (data.isMuted) {
    player.mute();
  } else {
    player.unMute();
  }
});

socket.on('player:pause', () => {
  if (!isPlayerReady) return;
  const state = player.getPlayerState();
   console.log('[Player.js] Recebido comando player:pause. Estado atual:', state);
  if (state === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else if (state === YT.PlayerState.PAUSED) {
    player.playVideo();
  }
});

socket.on('player:setVolume', (data) => {
  if (!isPlayerReady) return;
  console.log('[Player.js] Recebido comando player:setVolume:', data);
  player.setVolume(data.volume);
  if (data.isMuted) {
    player.mute();
  } else {
    player.unMute();
  }
});

// 5. Função para tocar vídeo (com TTS)
function playVideo({ videoId, title, message }) { // Recebe 'message'
  if (!isPlayerReady) {
    console.warn('[Player.js] Função playVideo chamada, mas o player não está pronto.');
    return;
  }

  console.log('[Player.js] Iniciando processo playVideo para:', title);

  if (synth && synth.speaking) synth.cancel();
  if (currentVideoTimer) {
    clearTimeout(currentVideoTimer);
    currentVideoTimer = null;
  }
  const currentState = player.getPlayerState();
  if (currentState === YT.PlayerState.PLAYING || currentState === YT.PlayerState.BUFFERING ) {
      console.log('[Player.js] Parando vídeo atual antes de carregar o próximo.');
      player.stopVideo();
  }

  // Função interna para carregar o vídeo
  const loadAndPlayVideo = () => {
    console.log(`[Player.js] Carregando vídeo: ${title} (${videoId})`);
    pendingVideo = null;
    player.loadVideoById(videoId);
  };

  // Verifica se há mensagem para falar E se a API de fala está disponível
  if (message && message.trim().length > 0 && synth) {
    console.log(`[Player.js] Preparando para falar a mensagem: "${message}"`);
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.7; // Velocidade ajustada
    utterance.rate = 1.0; // Velocidade ajustada
    utterance.pitch = 1.0;

    let speechTimeout = null;

    // QUANDO A FALA TERMINAR
    utterance.onend = () => {
      console.log('[Player.js] Mensagem falada. Tocando o vídeo...');
      if (speechTimeout) clearTimeout(speechTimeout);
      loadAndPlayVideo();
    };

    // QUANDO OCORRER ERRO na fala
    utterance.onerror = (event) => {
      console.error('[Player.js] Erro na síntese de fala:', event.error);
      if (speechTimeout) clearTimeout(speechTimeout);
      console.log('[Player.js] Erro na fala. Tocando o vídeo mesmo assim...');
      loadAndPlayVideo();
    };

    // Inicia a fala
    try {
        synth.cancel();
        setTimeout(() => {
            synth.speak(utterance);
            speechTimeout = setTimeout(() => {
                console.warn('[Player.js] Timeout da fala atingido. Forçando o play do vídeo.');
                synth.cancel();
                loadAndPlayVideo();
            }, 8000); // Timeout de 8 segundos
        }, 100);

    } catch (e) {
        console.error('[Player.js] Erro ao chamar synth.speak:', e);
        if (speechTimeout) clearTimeout(speechTimeout);
        loadAndPlayVideo();
    }

  } else {
    // Sem mensagem ou API de fala indisponível
    if (message && !synth) console.warn('[Player.js] Mensagem recebida, mas API de Fala não está disponível.');
    console.log('[Player.js] Tocando vídeo diretamente.');
    loadAndPlayVideo();
  }

}
