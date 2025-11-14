import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment } from "mercadopago";
import youtubeSearchApi from "youtube-search-api";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public")); // Garante que arquivos em /public (e subpastas) são servidos

const PORT = process.env.PORT || 3000;

// 🔹 Configuração do Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN // ❗️ DEVE SER SUA CHAVE DE PRODUÇÃO NAS ENV VARS DO RENDER
});

// Armazenamento temporário de pagamentos pendentes.
const pendingPayments = {}; // Agora armazena: { paymentId: { videos, amount, message, socketId } }

// 🔽🔽🔽 [VARIÁVEIS GLOBAIS DE ESTADO] 🔽🔽🔽
let dailyRevenue = 0.0;
let inactivityListNames = [];
let inactivityListIDs = [];
const INACTIVITY_TIMEOUT = 5000; // 5 segundos
let inactivityTimer = null;
let isCustomerPlaying = false;
let mainQueue = []; // Fila de objetos: { id, title, isCustomer, message? }
let nowPlayingInfo = null; // Objeto: { id, title, isCustomer, message? }
let currentVolume = 50; // Volume padrão
let isMuted = true; // Começa mutado para o autoplay
let currentPromoText = "Bem-vindo ao Contêiner Music Box!";
// 🔼🔼🔼 [FIM DAS VARIÁVEIS] 🔼🔼🔼


// 🔽🔽🔽 [FUNÇÃO HELPER] 🔽🔽🔽
/**
 * Busca um vídeo no YouTube pelo nome e retorna o ID do primeiro resultado.
 */
async function fetchVideoIdByName(name) {
  if (!name) return null;
  try {
    // Adiciona um pequeno delay para evitar rate limiting da API de busca (se necessário)
    // await new Promise(resolve => setTimeout(resolve, 100));
    const result = await youtubeSearchApi.GetListByKeyword(name, false, 1);
    if (result && result.items && result.items.length > 0 && result.items[0].id) {
      console.log(`Busca por "${name}" encontrou ID: ${result.items[0].id}`);
      return result.items[0].id;
    }
    console.warn(`Nenhum resultado de vídeo válido encontrado para "${name}"`);
    return null;
  } catch (err) {
    console.error(`Erro ao buscar ID para "${name}":`, err.message);
    // Considerar um retry simples em caso de erro de rede?
    // if (err.message.includes('network') || err.message.includes('timeout')) { ... }
    return null;
  }
}
// 🔼🔼🔼 [FIM DA FUNÇÃO] 🔼🔼🔼


// 🔽🔽🔽 [FUNÇÕES PRINCIPAIS DE CONTROLE] 🔽🔽🔽

/**
 * Envia o estado atual do player (Tocando Agora / Fila) para TODOS.
 */
function broadcastPlayerState() {
  const state = {
    nowPlaying: nowPlayingInfo,
    queue: mainQueue // Envia a fila inteira
  };
  io.emit('updatePlayerState', state); // Envia para clientes e admins
  console.log('[Server] Estado do player transmitido:', {
      nowPlaying: state.nowPlaying ? state.nowPlaying.title : 'Nenhum',
      queueLength: state.queue.length
  });
}

/**
 * Pega o próximo item da fila e manda o player tocar.
 */
function playNextInQueue() {
  // Limpa o timer de inatividade sempre que formos tocar algo (seja da fila ou não)
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  if (mainQueue.length > 0) {
    // Tira o próximo item da fila
    nowPlayingInfo = mainQueue.shift();
    isCustomerPlaying = nowPlayingInfo.isCustomer;

    console.log(`[Server] Enviando comando para tocar: ${nowPlayingInfo.title} (ID: ${nowPlayingInfo.id})`);
    // Manda o player tocar, incluindo a mensagem se houver
    io.emit('player:playVideo', {
      videoId: nowPlayingInfo.id,
      title: nowPlayingInfo.title,
      message: nowPlayingInfo.message // Pode ser null
    });

  } else {
    // A fila acabou
    console.log('[Server] Fila principal vazia.');
    nowPlayingInfo = null;
    isCustomerPlaying = false;
    // Inicia o timer de inatividade
    startInactivityTimer();
  }

  // Informa a todos (cliente e admin) o que está tocando agora e o que vem por aí
  broadcastPlayerState();
}

/**
 * Inicia o timer de inatividade.
 */
function startInactivityTimer() {
  // Limpa qualquer timer anterior
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  // Só inicia o timer se nada estiver tocando E a fila estiver vazia
  if (nowPlayingInfo || mainQueue.length > 0) {
      console.log('[Server] Algo está tocando ou na fila, não iniciando timer de inatividade.');
      return;
  }

  console.log(`[Server] Iniciando timer de inatividade de ${INACTIVITY_TIMEOUT / 1000}s...`);

  inactivityTimer = setTimeout(() => {
    // Verifica novamente se algo começou a tocar enquanto o timer rodava
    if (nowPlayingInfo || mainQueue.length > 0) {
        console.log('[Server] Timer de inatividade expirou, mas algo já está na fila/tocando. Timer cancelado.');
        return;
    }

    // Se não for música de cliente (já verificado por nowPlayingInfo) e a lista de inatividade existir
    if (inactivityListIDs.length > 0) {
      console.log('[Server] Inatividade detectada. Tocando lista de inatividade.');

      // Cria a fila de inatividade com títulos genéricos
      mainQueue = inactivityListIDs.map(id => ({
        id: id,
        title: '(Música da Casa)',
        isCustomer: false,
        message: null // Lista da casa não tem mensagem
      }));

      // Toca o primeiro item
      playNextInQueue();
    } else {
        console.log('[Server] Timer de inatividade expirou, mas a lista está vazia.');
        // Garante que o estado seja transmitido mesmo se nada tocar
        broadcastPlayerState();
    }
  }, INACTIVITY_TIMEOUT);
}
// 🔼🔼🔼 [FIM DAS NOVAS FUNÇÕES DE CONTROLE] 🔼🔼🔼


// 🔹 Endpoint para buscar músicas no YouTube (Cliente)
app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ ok: false, error: "Consulta inválida" });

    console.log(`[Server] Cliente buscando por: "${query}"`);
    const result = await youtubeSearchApi.GetListByKeyword(query, false, 6); // Limita a 6 resultados

    const items = result.items
      .filter(item => item.id && item.title && item.thumbnail?.thumbnails?.length > 0) // Garante dados mínimos
      .map(item => ({
        id: item.id,
        title: item.title,
        channel: item.channel?.name ?? 'Canal Indefinido',
        thumbnail: item.thumbnail.thumbnails[0].url
      }));

    res.json({ ok: true, results: items });
  } catch (err) {
    console.error("[Server] Erro ao buscar vídeos para cliente:", err.message);
    res.status(500).json({ ok: false, error: "Erro interno ao buscar vídeos" });
  }
});

// 🔹 Endpoint para criar pagamento PIX (com socketId e payer placeholder)
app.post("/create-payment", async (req, res) => {
  try {
    // Recebe 'socketId' do frontend
    const { videos, amount, description, message, socketId } = req.body;

    // Valida dados essenciais (incluindo socketId)
    if (!videos || videos.length === 0 || !amount || !description || !socketId) {
      console.error('[Server] Dados inválidos recebidos para /create-payment:', req.body);
      return res.status(400).json({ ok: false, error: "Dados inválidos para pagamento (faltando socketId?)." });
    }

    // URL REAL DO SEU SITE RENDER
    const notification_url = "https://conteinermusic.onrender.com/webhook";

    console.log(`[Server] Criando pagamento PIX para socket ${socketId}: ${description}, Valor: ${amount}`);
    const payment_data = {
        transaction_amount: Number(amount),
        description: description,
        payment_method_id: "pix",
        payer: { email: "pagador@email.com" }, // Placeholder obrigatório para produção PIX
        notification_url: notification_url
    };

    const payment = new Payment(mpClient);
    const result = await payment.create({ body: payment_data });

    // Validação mais robusta da resposta do MP
    if (!result?.point_of_interaction?.transaction_data?.qr_code_base64) {
        console.error('[Server] Resposta do Mercado Pago inválida:', result);
        throw new Error('Resposta do Mercado Pago inválida - QR Code não encontrado.');
    }

    const qrData = result.point_of_interaction.transaction_data;

    // Salva o socketId junto com os outros dados
    pendingPayments[result.id] = { videos: videos, amount: Number(amount), message: message, socketId: socketId };
    console.log(`[Server] Pagamento ${result.id} (${description}) criado para socket ${socketId}, aguardando webhook...`);

    res.json({
      ok: true,
      qr: qrData.qr_code_base64,
      copiaCola: qrData.qr_code
    });

  } catch (err) {
    console.error("[Server] Erro CRÍTICO ao criar pagamento PIX:", err);
    // Tenta extrair a mensagem de erro específica do Mercado Pago
    let specificError = "Falha ao gerar pagamento no servidor.";
    if (err.cause?.error?.message) {
        specificError = `MP Error: ${err.cause.error.message}`;
    } else if (err.cause?.message) {
        specificError = `MP Error: ${err.cause.message}`;
    } else if (err.message) {
        specificError = err.message;
    }
     // Adiciona o status code se disponível
    if (err.statusCode) {
        specificError += ` (Status: ${err.statusCode})`;
    }

    console.error("[Server] Erro específico do MP:", specificError);
    // Usa o status code do erro do MP, ou 500 como padrão
    res.status(err.statusCode || 500).json({ ok: false, error: specificError });
  }
});


// 🔹 Webhook para receber confirmação de pagamento (Lógica Corrigida)
app.post("/webhook", async (req, res) => {
  console.log("[Server] Webhook recebido!");
  // console.log("[Server] Corpo do Webhook:", req.body); // Descomente para depuração

  try {
    const notification = req.body;
    let paymentId = null;

    // --- Identifica o ID do pagamento (Aceita ambos formatos) ---
    if (notification?.type === 'payment' && notification.data?.id) {
        paymentId = notification.data.id;
        console.log(`[Server] Notificação detalhada recebida para ID: ${paymentId}`);
    } else if (notification?.topic === 'payment' && notification.resource) {
        // Extrai o ID da URL do resource
        const urlParts = notification.resource.split('/');
        paymentId = urlParts[urlParts.length - 1];
        if (!paymentId) { console.warn('[Server] Não foi possível extrair paymentId da URL do resource:', notification.resource); }
        else { console.log(`[Server] Notificação simples recebida para ID: ${paymentId}`); }
    } else if (notification?.action?.startsWith('payment.') && notification.data?.id) {
         paymentId = notification.data.id;
         console.log(`[Server] Notificação de ação recebida para ID: ${paymentId}`);
    }

    if (!paymentId) {
        console.warn('[Server] Notificação de webhook não reconhecida ou sem ID de pagamento válido.');
        return res.sendStatus(200); // Responde OK mesmo assim
    }

    // --- Busca os detalhes do pagamento SEMPRE ---
    console.log(`[Server] Buscando detalhes do pagamento ${paymentId} no Mercado Pago...`);
    const payment = new Payment(mpClient);
    const paymentDetails = await payment.get({ id: paymentId });
    console.log(`[Server] Detalhes do pagamento ${paymentId}: Status ${paymentDetails.status}`);

    // --- Processa APENAS se estiver Aprovado E Pendente na nossa lista ---
    if (paymentDetails.status === 'approved' && pendingPayments[paymentId]) {
      console.log(`[Server] Pagamento ${paymentId} APROVADO! Processando pedido.`);

      const order = pendingPayments[paymentId]; // Contém { videos, amount, message, socketId }

      // 1. Atualiza o faturamento
      dailyRevenue += order.amount;
      io.emit('admin:updateRevenue', dailyRevenue);

      // 2. Define prioridade e para timer
      isCustomerPlaying = true;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;

      // 3. Prepara os vídeos
      const customerVideos = order.videos.map(v => ({ ...v, isCustomer: true, message: order.message }));

      // 4. Adiciona à fila / Toca
      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
        console.log('[Server] Música da casa interrompida para tocar cliente.');
        mainQueue = [...customerVideos, ...mainQueue];
        playNextInQueue();
      } else {
        mainQueue.push(...customerVideos);
        if (!nowPlayingInfo) {
            console.log('[Server] Player ocioso, iniciando fila do cliente.');
            playNextInQueue();
        } else {
            console.log('[Server] Player ocupado, adicionando cliente ao fim da fila.');
            broadcastPlayerState();
        }
      }

      // 5. ENVIA CONFIRMAÇÃO PARA O CLIENTE ESPECÍFICO
      if (order.socketId) {
          console.log(`[Server] TENTANDO ENVIAR 'paymentConfirmed' para socket ${order.socketId}`);
          const targetSocket = io.sockets.sockets.get(order.socketId);
          if (targetSocket) {
              targetSocket.emit('paymentConfirmed');
              console.log(`[Server] 'paymentConfirmed' EMITIDO com sucesso para ${order.socketId}.`);
          } else {
               console.warn(`[Server] Socket ${order.socketId} não encontrado. Não foi possível enviar 'paymentConfirmed'. O cliente pode ter desconectado.`);
          }
      } else {
          console.warn(`[Server] Não foi possível encontrar socketId para o pagamento ${paymentId} para enviar confirmação.`);
      }

      // 6. Remove da lista de pendentes APÓS processar
      delete pendingPayments[paymentId];
      console.log(`[Server] Pagamento ${paymentId} processado e removido da lista de pendentes.`);

    } else if (paymentDetails.status !== 'approved' && pendingPayments[paymentId]) {
      // Pagamento ainda não aprovado (pending, rejected, etc.)
      console.log(`[Server] Status do pagamento ${paymentId} ainda é '${paymentDetails.status}'. Aguardando aprovação (não removendo dos pendentes).`);
    } else if (!pendingPayments[paymentId]) {
        console.log(`[Server] Notificação recebida para pagamento ${paymentId} (Status: ${paymentDetails.status}) que não estava pendente ou já foi processado.`);
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("[Server] Erro CRÍTICO no processamento do webhook:", err);
    res.sendStatus(500);
  }
});


// 🔹 Comunicação via socket.io
io.on("connection", (socket) => {
  console.log("[Server] Cliente Socket.IO conectado:", socket.id);

  // Envia estado inicial assim que conecta
  socket.emit('updatePlayerState', { nowPlaying: nowPlayingInfo, queue: mainQueue });
  socket.emit('player:updatePromoText', currentPromoText);

  // --- Lógica de Simulação (Cliente - Comentada no main.js) ---
  socket.on('simulatePlay', ({ videos, message }) => {
    if (videos && videos.length > 0) {
      console.log(`[Server] [SIMULAÇÃO] Recebido pedido de cliente.`);

      isCustomerPlaying = true;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;

      const customerVideos = videos.map(v => ({
          ...v,
          isCustomer: true,
          message: message
      }));

      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
         console.log('[Server] [SIMULAÇÃO] Música da casa interrompida para tocar simulação.');
        mainQueue = [...customerVideos, ...mainQueue];
        playNextInQueue();
      } else {
        mainQueue.push(...customerVideos);
        if (!nowPlayingInfo) {
            console.log('[Server] [SIMULAÇÃO] Player ocioso, iniciando fila simulada.');
            playNextInQueue();
        } else {
             console.log('[Server] [SIMULAÇÃO] Player ocupado, adicionando simulação ao fim da fila.');
             broadcastPlayerState();
        }
      }
    }
  });

  // --- Eventos do Player (TV) ---
  socket.on('player:ready', () => {
    console.log(`[Server] Player (TV) está pronto: ${socket.id}`);
    socket.emit('player:setInitialState', { volume: currentVolume, isMuted: isMuted });
    socket.emit('player:updatePromoText', currentPromoText);

    if (!nowPlayingInfo) {
      startInactivityTimer();
    }
  });

  socket.on('player:videoEnded', () => {
    console.log('[Server] Player informa: vídeo terminou. Tocando o próximo.');
    playNextInQueue();
  });

  socket.on('player:ping', () => {
    console.log(`[Server] Ping keep-alive recebido do player: ${socket.id}`);
  });


  // --- Eventos do Painel Admin ---
  socket.on('admin:getList', () => {
    console.log(`[Server] Admin ${socket.id} pediu estado inicial.`);
    socket.emit('admin:loadInactivityList', inactivityListNames);
    socket.emit('admin:updateRevenue', dailyRevenue);
    socket.emit('admin:updatePlayerState', { nowPlaying: nowPlayingInfo, queue: mainQueue });
    socket.emit('admin:updateVolume', { volume: currentVolume, isMuted: isMuted });
    socket.emit('admin:loadPromoText', currentPromoText);
  });

  socket.on('admin:saveInactivityList', async (nameArray) => {
    console.log('[Server] Admin salvou a lista de nomes:', nameArray);
    inactivityListNames = Array.isArray(nameArray) ? nameArray : [];

    const idPromises = inactivityListNames.map(name => fetchVideoIdByName(name));
    inactivityListIDs = (await Promise.all(idPromises)).filter(id => id !== null);

    console.log('[Server] Lista de IDs de inatividade salva:', inactivityListIDs);

    if (!isCustomerPlaying && !nowPlayingInfo) {
      startInactivityTimer();
    }
  });

  socket.on('admin:search', async (query) => {
    try {
      if (!query) return;
      console.log(`[Server] Admin ${socket.id} buscando por: "${query}"`);
      const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);

      const items = result.items
        .filter(item => item.id && item.title)
        .map(item => ({
          id: item.id,
          title: item.title,
          channel: item.channel?.name ?? 'Indefinido'
        }));

      socket.emit('admin:searchResults', items);

    } catch (err) {
      console.error('[Server] Erro na busca do admin:', err.message);
      socket.emit('admin:searchResults', []);
    }
  });

  // ❗️❗️ [LÓGICA CORRIGIDA: admin:addVideo] ❗️❗️
  // Agora sempre adiciona ao final da fila, não interrompe mais.
  socket.on('admin:addVideo', ({ videoId, videoTitle }) => {
    if (videoId && videoTitle) {
      console.log(`[Server] Admin ${socket.id} adicionou um vídeo: ${videoTitle}`);

      // Cria o item da fila sem mensagem
      const adminVideo = { id: videoId, title: videoTitle, isCustomer: false, message: null };

      // LÓGICA ANTIGA QUE INTERROMPIA (removida):
      // if (nowPlayingInfo && !nowPlayingInfo.isCustomer) { ... }
      
      // NOVA LÓGICA (sempre adiciona ao fim):
      mainQueue.push(adminVideo);
      if (!nowPlayingInfo) {
           console.log('[Server] Player ocioso, iniciando vídeo do admin.');
           playNextInQueue(); // Começa a tocar se nada estiver tocando
      } else {
           console.log('[Server] Player ocupado, adicionando vídeo do admin ao fim da fila.');
           broadcastPlayerState(); // Apenas atualiza a UI da fila
      }

    } else {
        console.warn(`[Server] Admin ${socket.id} tentou adicionar vídeo inválido:`, { videoId, videoTitle });
    }
  });

  socket.on('admin:setPromoText', (text) => {
    currentPromoText = text || "";
    console.log(`[Server] Admin ${socket.id} definiu o texto promocional para: "${currentPromoText}"`);
    io.emit('player:updatePromoText', currentPromoText);
    io.emit('admin:loadPromoText', currentPromoText);
  });

  // --- Controles do Admin ---

  socket.on('admin:controlSkip', () => {
    console.log(`[Server] Admin ${socket.id} pulou a música.`);
    playNextInQueue();
  });

  socket.on('admin:controlPause', () => {
    console.log(`[Server] Admin ${socket.id} pausou/tocou a música.`);
    io.emit('player:pause');
  });

  socket.on('admin:controlVolume', ({ volume }) => {
    const newVolume = parseInt(volume, 10);
    if (isNaN(newVolume) || newVolume < 0 || newVolume > 100) {
        console.warn(`[Server] Admin ${socket.id} enviou volume inválido:`, volume);
        return;
    }
    currentVolume = newVolume;
    isMuted = (currentVolume === 0);

    console.log(`[Server] Admin ${socket.id} definiu o volume para: ${currentVolume} (Mudo: ${isMuted})`);

    io.emit('admin:updateVolume', { volume: currentVolume, isMuted: isMuted });
    io.emit('player:setVolume', { volume: currentVolume, isMuted: isMuted });
  });


  // --- Desconexão ---
  socket.on("disconnect", (reason) => {
    console.log(`[Server] Cliente Socket.IO desconectado: ${socket.id}. Razão: ${reason}`);
  });
});

// 🔹 Iniciar servidor
server.listen(PORT, () => {
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
