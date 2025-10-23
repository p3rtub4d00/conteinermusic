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
const pendingPayments = {};

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
  console.log('[Server] Estado do player transmitido:', state);
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

  // Só inicia o timer se nada estiver tocando
  if (nowPlayingInfo) {
      console.log('[Server] Algo está tocando, não iniciando timer de inatividade.');
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

// 🔹 Endpoint para criar pagamento PIX
app.post("/create-payment", async (req, res) => {
  try {
    const { videos, amount, description, message } = req.body;

    if (!videos || videos.length === 0 || !amount || !description) {
      console.error('[Server] Dados inválidos recebidos para /create-payment:', req.body);
      return res.status(400).json({ ok: false, error: "Dados inválidos para pagamento." });
    }

    // URL REAL DO SEU SITE RENDER
    const notification_url = "https://conteinermusic.onrender.com/webhook";

    console.log(`[Server] Criando pagamento PIX: ${description}, Valor: ${amount}`);
    const payment_data = {
        transaction_amount: Number(amount),
        description: description,
        payment_method_id: "pix",
        payer: { email: "pagador@email.com" }, // Placeholder obrigatório
        notification_url: notification_url
    };

    const payment = new Payment(mpClient);
    const result = await payment.create({ body: payment_data });

    if (!result.point_of_interaction?.transaction_data?.qr_code_base64) {
        throw new Error('Resposta do Mercado Pago inválida - QR Code não encontrado.');
    }

    const qrData = result.point_of_interaction.transaction_data;

    pendingPayments[result.id] = { videos: videos, amount: Number(amount), message: message };
    console.log(`[Server] Pagamento ${result.id} (${description}) criado, aguardando webhook...`);

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
    res.status(err.statusCode || 500).json({ ok: false, error: specificError });
  }
});


// 🔹 Webhook para receber confirmação de pagamento
app.post("/webhook", async (req, res) => {
  console.log("[Server] Webhook recebido!");
  console.log("[Server] Corpo do Webhook:", req.body); // Log para depuração

  try {
    const notification = req.body;

    // Validação básica do corpo da notificação
    if (!notification || notification.type !== 'payment' || !notification.data?.id) {
        console.warn('[Server] Notificação de webhook inválida ou não é de pagamento.');
        return res.sendStatus(400); // Bad Request
    }

    const paymentId = notification.data.id;
    console.log(`[Server] Notificação de pagamento recebida para ID: ${paymentId}`);

    // Busca os detalhes do pagamento no Mercado Pago
    const payment = new Payment(mpClient);
    const paymentDetails = await payment.get({ id: paymentId });
    console.log(`[Server] Detalhes do pagamento ${paymentId}: Status ${paymentDetails.status}`);

    // Verifica se o pagamento foi aprovado E se estava na nossa lista de pendentes
    if (paymentDetails.status === 'approved' && pendingPayments[paymentId]) {
      console.log(`[Server] Pagamento ${paymentId} APROVADO! Processando pedido.`);

      const order = pendingPayments[paymentId];

      // 1. Atualiza o faturamento
      dailyRevenue += order.amount;
      io.emit('admin:updateRevenue', dailyRevenue); // Envia para o admin

      // 2. Define que o cliente tem prioridade e para o timer de inatividade
      isCustomerPlaying = true;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;

      // 3. Prepara os vídeos do cliente para adicionar à fila
      const customerVideos = order.videos.map(v => ({
        ...v,
        isCustomer: true,
        message: order.message // Adiciona a mensagem do pedido
      }));

      // 4. Adiciona à fila e decide se toca agora
      // Se a lista da casa estiver tocando, interrompe e coloca o cliente primeiro
      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
        console.log('[Server] Música da casa interrompida para tocar cliente.');
        mainQueue = [...customerVideos, ...mainQueue]; // Cliente primeiro, resto da fila depois
        playNextInQueue(); // Pula a música da casa e toca a do cliente
      } else {
        // Se não, só adiciona no fim da fila
        mainQueue.push(...customerVideos);
        if (!nowPlayingInfo) {
            console.log('[Server] Player ocioso, iniciando fila do cliente.');
            playNextInQueue(); // Começa a tocar se nada estiver tocando
        } else {
            console.log('[Server] Player ocupado, adicionando cliente ao fim da fila.');
            broadcastPlayerState(); // Apenas atualiza a UI da fila
        }
      }

      // 5. Remove da lista de pendentes após processar
      delete pendingPayments[paymentId];

    } else if (pendingPayments[paymentId]) {
      // Pagamento não aprovado, mas estava pendente (Ex: recusado, cancelado)
      console.log(`[Server] Pagamento ${paymentId} não foi aprovado (Status: ${paymentDetails.status}). Removendo da lista de pendentes.`);
      delete pendingPayments[paymentId]; // Limpa para evitar processamento futuro
    } else {
        // Recebeu notificação de um pagamento que não conhecemos (pode acontecer)
        console.log(`[Server] Notificação recebida para pagamento ${paymentId} (Status: ${paymentDetails.status}) que não estava pendente.`);
    }

    res.sendStatus(200); // Responde OK para o Mercado Pago

  } catch (err) {
    console.error("[Server] Erro CRÍTICO no processamento do webhook:", err);
    res.sendStatus(500); // Informa erro, mas MP pode tentar de novo
  }
});


// 🔹 Comunicação via socket.io
io.on("connection", (socket) => {
  console.log("[Server] Cliente Socket.IO conectado:", socket.id);

  // Envia estado inicial assim que conecta
  socket.emit('updatePlayerState', { nowPlaying: nowPlayingInfo, queue: mainQueue });
  socket.emit('player:updatePromoText', currentPromoText);

  // --- Lógica de Simulação (Cliente) ---
  socket.on('simulatePlay', ({ videos, message }) => {
    if (videos && videos.length > 0) {
      console.log(`[Server] [SIMULAÇÃO] Recebido pedido de cliente.`);

      isCustomerPlaying = true; // Simulação sempre tem prioridade
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;

      const customerVideos = videos.map(v => ({
          ...v,
          isCustomer: true,
          message: message // Adiciona a mensagem da simulação
      }));

      // Se a lista da casa estiver tocando, interrompe e coloca o cliente primeiro
      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
         console.log('[Server] [SIMULAÇÃO] Música da casa interrompida para tocar simulação.');
        mainQueue = [...customerVideos, ...mainQueue];
        playNextInQueue();
      } else {
        // Se não, só adiciona no fim da fila
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

    // Só inicia o timer se o servidor não achar que algo já devia estar tocando
    if (!nowPlayingInfo) {
      startInactivityTimer();
    }
  });

  socket.on('player:videoEnded', () => {
    console.log('[Server] Player informa: vídeo terminou. Tocando o próximo.');
    playNextInQueue(); // Toca o próximo da fila gerenciada pelo servidor
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
    inactivityListNames = Array.isArray(nameArray) ? nameArray : []; // Garante que é array

    // Busca os IDs para cada nome em paralelo
    const idPromises = inactivityListNames.map(name => fetchVideoIdByName(name));
    // Espera todas as buscas e filtra IDs nulos (busca falhou ou não encontrou)
    inactivityListIDs = (await Promise.all(idPromises)).filter(id => id !== null);

    console.log('[Server] Lista de IDs de inatividade salva:', inactivityListIDs);

    // Se o player estiver ocioso (nada tocando), reinicia o timer para considerar a nova lista
    if (!isCustomerPlaying && !nowPlayingInfo) {
      startInactivityTimer();
    }
  });

  socket.on('admin:search', async (query) => {
    try {
      if (!query) return;
      console.log(`[Server] Admin ${socket.id} buscando por: "${query}"`);
      const result = await youtubeSearchApi.GetListByKeyword(query, false, 5); // Limita a 5 resultados

      const items = result.items
        .filter(item => item.id && item.title)
        .map(item => ({
          id: item.id,
          title: item.title,
          channel: item.channel?.name ?? 'Indefinido'
        }));

      // Envia os resultados de volta APENAS para o admin que buscou
      socket.emit('admin:searchResults', items);

    } catch (err) {
      console.error('[Server] Erro na busca do admin:', err.message);
      socket.emit('admin:searchResults', []); // Envia lista vazia em caso de erro
    }
  });

  socket.on('admin:addVideo', ({ videoId, videoTitle }) => {
    if (videoId && videoTitle) {
      console.log(`[Server] Admin ${socket.id} adicionou um vídeo: ${videoTitle}`);

      // Cria o item da fila sem mensagem
      const adminVideo = { id: videoId, title: videoTitle, isCustomer: false, message: null };

      // Se a lista da casa estiver tocando, interrompe e toca este
      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
         console.log('[Server] Música da casa interrompida para tocar vídeo do admin.');
        mainQueue = [adminVideo, ...mainQueue]; // Adiciona no início
        playNextInQueue(); // Pula a música da casa
      } else {
        // Senão, adiciona no fim da fila
        mainQueue.push(adminVideo);
        if (!nowPlayingInfo) {
             console.log('[Server] Player ocioso, iniciando vídeo do admin.');
             playNextInQueue(); // Começa a tocar se nada estiver tocando
        } else {
             console.log('[Server] Player ocupado, adicionando vídeo do admin ao fim da fila.');
             broadcastPlayerState(); // Apenas atualiza a UI da fila
        }
      }
    } else {
        console.warn(`[Server] Admin ${socket.id} tentou adicionar vídeo inválido:`, { videoId, videoTitle });
    }
  });

  socket.on('admin:setPromoText', (text) => {
    currentPromoText = text || ""; // Garante que é uma string
    console.log(`[Server] Admin ${socket.id} definiu o texto promocional para: "${currentPromoText}"`);
    // Envia para todos os players e admins
    io.emit('player:updatePromoText', currentPromoText);
    io.emit('admin:loadPromoText', currentPromoText); // Atualiza outros admins
  });

  // --- Controles do Admin ---

  socket.on('admin:controlSkip', () => {
    console.log(`[Server] Admin ${socket.id} pulou a música.`);
    playNextInQueue(); // Força o próximo item da fila gerenciada pelo servidor
  });

  socket.on('admin:controlPause', () => {
    console.log(`[Server] Admin ${socket.id} pausou/tocou a música.`);
    io.emit('player:pause'); // Envia para todos os players
  });

  socket.on('admin:controlVolume', ({ volume }) => {
    // Valida o volume
    const newVolume = parseInt(volume, 10);
    if (isNaN(newVolume) || newVolume < 0 || newVolume > 100) {
        console.warn(`[Server] Admin ${socket.id} enviou volume inválido:`, volume);
        return;
    }
    currentVolume = newVolume;
    isMuted = (currentVolume === 0);

    console.log(`[Server] Admin ${socket.id} definiu o volume para: ${currentVolume} (Mudo: ${isMuted})`);

    // Envia o novo volume para todos os players E todos os admins (para sincronizar sliders)
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
  // Render define a porta, então usamos PORT aqui. Localmente será 3000.
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
