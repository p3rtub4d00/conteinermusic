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
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN // ❗️ USE SUA CHAVE DE PRODUÇÃO
});

// Armazenamento temporário de pagamentos pendentes.
const pendingPayments = {};

// 🔽🔽🔽 [VARIÁVEIS GLOBAIS DE ESTADO] 🔽🔽🔽
let dailyRevenue = 0.0;
let inactivityListNames = [];
let inactivityListIDs = [];
const INACTIVITY_TIMEOUT = 5000; 
let inactivityTimer = null;
let isCustomerPlaying = false; 
let mainQueue = []; // { id, title, isCustomer, message? }
let nowPlayingInfo = null; // { id, title, isCustomer, message? }
let currentVolume = 50; 
let isMuted = true; 
let currentPromoText = "Bem-vindo ao Contêiner Music Box!";
// 🔼🔼🔼 [FIM DAS VARIÁVEIS] 🔼🔼🔼


// 🔽🔽🔽 [FUNÇÃO HELPER] 🔽🔽🔽
async function fetchVideoIdByName(name) {
  if (!name) return null;
  try {
    const result = await youtubeSearchApi.GetListByKeyword(name, false, 1);
    if (result && result.items && result.items.length > 0) {
      console.log(`Busca por "${name}" encontrou ID: ${result.items[0].id}`);
      return result.items[0].id;
    }
    console.warn(`Nenhum resultado encontrado para "${name}"`);
    return null;
  } catch (err) {
    console.error(`Erro ao buscar ID para "${name}":`, err.message);
    return null;
  }
}
// 🔼🔼🔼 [FIM DA FUNÇÃO] 🔼🔼🔼


// 🔽🔽🔽 [FUNÇÕES PRINCIPAIS DE CONTROLE] 🔽🔽🔽
function broadcastPlayerState() {
  const state = {
    nowPlaying: nowPlayingInfo,
    queue: mainQueue 
  };
  io.emit('updatePlayerState', state);
}

function playNextInQueue() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
  
  if (mainQueue.length > 0) {
    nowPlayingInfo = mainQueue.shift(); 
    isCustomerPlaying = nowPlayingInfo.isCustomer;
    
    console.log(`Servidor enviando comando para tocar: ${nowPlayingInfo.title}`);
    io.emit('player:playVideo', { 
      videoId: nowPlayingInfo.id, 
      title: nowPlayingInfo.title,
      message: nowPlayingInfo.message 
    });
    
  } else {
    nowPlayingInfo = null;
    isCustomerPlaying = false;
    startInactivityTimer();
  }
  
  broadcastPlayerState();
}

function startInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
  
  if (nowPlayingInfo) return; 

  console.log(`Iniciando timer de inatividade de ${INACTIVITY_TIMEOUT / 1000}s...`);

  inactivityTimer = setTimeout(() => {
    if (!isCustomerPlaying && inactivityListIDs.length > 0) {
      console.log('Inatividade detectada. Tocando lista de inatividade.');
      
      mainQueue = inactivityListIDs.map(id => ({
        id: id,
        title: '(Música da Casa)',
        isCustomer: false,
        message: null 
      }));
      
      playNextInQueue();
    }
  }, INACTIVITY_TIMEOUT);
}
// 🔼🔼🔼 [FIM DAS NOVAS FUNÇÕES DE CONTROLE] 🔼🔼🔼


// 🔹 [ESSA ROTA ESTAVA FALTANDO] Endpoint para buscar músicas no YouTube (Cliente)
app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: "Consulta inválida" });

    const result = await youtubeSearchApi.GetListByKeyword(query, false, 6);
    
    const items = result.items
      .filter(item => item.id && item.title)
      .map(item => ({
        id: item.id,
        title: item.title,
        channel: item.channel?.name ?? 'Canal Indefinido',
        thumbnail: item.thumbnail?.thumbnails[0]?.url ?? 'https://via.placeholder.com/120'
      }));

    res.json({ ok: true, results: items });
  } catch (err) {
    console.error("Erro ao buscar vídeos:", err.message); 
    res.status(500).json({ ok: false, error: "Erro ao buscar vídeos" });
  }
});

// 🔹 Endpoint para criar pagamento PIX
app.post("/create-payment", async (req, res) => {
  try {
    const { videos, amount, description, message } = req.body; 
    
    if (!videos || videos.length === 0 || !amount || !description) {
      return res.status(400).json({ ok: false, error: "Dados inválidos para pagamento." });
    }

    // ❗️❗️ USE UMA URL HTTPS PÚBLICA VÁLIDA AQUI ❗️❗️
    const notification_url = "https://SEU_DOMINIO_PUBLICO.com/webhook"; 
    
    const payment = new Payment(mpClient);
    const result = await payment.create({
      body: {
        transaction_amount: Number(amount), 
        description: description,        
        payment_method_id: "pix",
        payer: { email: "test_user_123456@testuser.com" }, // E-mail para teste
        notification_url: notification_url
      }
    });

    const qrData = result.point_of_interaction.transaction_data;

    pendingPayments[result.id] = { videos: videos, amount: Number(amount), message: message }; 
    console.log(`Pagamento ${result.id} (${description}) criado, aguardando webhook...`);

    res.json({
      ok: true,
      qr: qrData.qr_code_base64,
      copiaCola: qrData.qr_code
    });

  } catch (err) {
    console.error("Erro ao criar pagamento PIX:", err.message); 
    const errorMessage = err.cause?.error?.message || err.message || "Falha ao gerar pagamento";
    res.status(500).json({ ok: false, error: errorMessage });
  }
});

// 🔹 Webhook para receber confirmação de pagamento
app.post("/webhook", async (req, res) => {
  console.log("Webhook recebido!");
  
  try {
    const notification = req.body;

    if (notification.type === 'payment') {
      const paymentId = notification.data.id;
      const payment = new Payment(mpClient);
      const paymentDetails = await payment.get({ id: paymentId });

      if (paymentDetails.status === 'approved' && pendingPayments[paymentId]) {
        console.log(`Pagamento ${paymentId} APROVADO!`);

        const order = pendingPayments[paymentId];
        
        dailyRevenue += order.amount;
        io.emit('admin:updateRevenue', dailyRevenue); 
        
        isCustomerPlaying = true;
        if (inactivityTimer) clearTimeout(inactivityTimer); 
        inactivityTimer = null;

        const customerVideos = order.videos.map(v => ({ 
          ...v, 
          isCustomer: true,
          message: order.message 
        }));
        
        if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
          mainQueue = [...customerVideos, ...mainQueue];
          playNextInQueue(); 
        } else {
          mainQueue.push(...customerVideos);
          if (!nowPlayingInfo) playNextInQueue(); 
          else broadcastPlayerState(); 
        }

        delete pendingPayments[paymentId];
      
      } else {
        console.log(`Status do pagamento: ${paymentDetails.status}`);
      }
    }
    res.sendStatus(200);

  } catch (err)
 {
    console.error("Erro no webhook:", err.message);
    res.sendStatus(500);
  }
});


// 🔹 Comunicação via socket.io
io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);
  
  // Envia estado inicial
  socket.emit('updatePlayerState', { nowPlaying: nowPlayingInfo, queue: mainQueue });
  socket.emit('player:updatePromoText', currentPromoText);

  // --- Lógica de Simulação (Cliente) ---
  socket.on('simulatePlay', ({ videos, message }) => { 
    if (videos && videos.length > 0) {
      console.log(`[SIMULAÇÃO] Recebido pedido de cliente.`);
      
      isCustomerPlaying = true;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;

      const customerVideos = videos.map(v => ({ 
          ...v, 
          isCustomer: true,
          message: message 
      }));

      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
        mainQueue = [...customerVideos, ...mainQueue];
        playNextInQueue(); 
      } else {
        mainQueue.push(...customerVideos);
        if (!nowPlayingInfo) playNextInQueue(); 
        else broadcastPlayerState(); 
      }
    }
  });
  
  // --- Eventos do Player (TV) ---
  socket.on('player:ready', () => {
    console.log(`Player (TV) está pronto: ${socket.id}`);
    socket.emit('player:setInitialState', { volume: currentVolume, isMuted: isMuted });
    socket.emit('player:updatePromoText', currentPromoText);
    
    // Só inicia o timer se o servidor não achar que algo já devia estar tocando
    if (!nowPlayingInfo) {
      startInactivityTimer();
    }
  });

  socket.on('player:videoEnded', () => {
    console.log('Player informa: vídeo terminou.');
    playNextInQueue(); 
  });


  // --- Eventos do Painel Admin ---
  socket.on('admin:getList', () => {
    socket.emit('admin:loadInactivityList', inactivityListNames);
    socket.emit('admin:updateRevenue', dailyRevenue);
    socket.emit('admin:updatePlayerState', { nowPlaying: nowPlayingInfo, queue: mainQueue });
    socket.emit('admin:updateVolume', { volume: currentVolume, isMuted: isMuted });
    socket.emit('admin:loadPromoText', currentPromoText); 
  });
  
  socket.on('admin:saveInactivityList', async (nameArray) => {
    console.log('Admin salvou a lista de nomes:', nameArray);
    inactivityListNames = nameArray;
    
    const idPromises = nameArray.map(name => fetchVideoIdByName(name));
    inactivityListIDs = (await Promise.all(idPromises)).filter(id => id !== null);
    
    console.log('Lista de IDs de inatividade salva:', inactivityListIDs);
    
    if (!isCustomerPlaying && !nowPlayingInfo) {
      startInactivityTimer();
    }
  });

  socket.on('admin:search', async (query) => {
    try {
      if (!query) return;
      console.log(`Admin buscando por: "${query}"`);
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
      console.error('Erro na busca do admin:', err.message);
      socket.emit('admin:searchResults', []);
    }
  });

  socket.on('admin:addVideo', ({ videoId, videoTitle }) => {
    if (videoId) {
      console.log(`Admin adicionou um vídeo: ${videoTitle}`);
      
      const adminVideo = { id: videoId, title: videoTitle, isCustomer: false, message: null };

      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
        mainQueue = [adminVideo, ...mainQueue];
        playNextInQueue();
      } else {
        mainQueue.push(adminVideo);
        if (!nowPlayingInfo) playNextInQueue();
        else broadcastPlayerState();
      }
    }
  });
  
  socket.on('admin:setPromoText', (text) => {
    currentPromoText = text || ""; 
    console.log(`Admin definiu o texto promocional para: "${currentPromoText}"`);
    io.emit('player:updatePromoText', currentPromoText); 
    io.emit('admin:loadPromoText', currentPromoText); 
  });
  
  // --- Controles do Admin ---
  
  socket.on('admin:controlSkip', () => {
    console.log('Admin pulou a música.');
    playNextInQueue(); 
  });

  socket.on('admin:controlPause', () => {
    console.log('Admin pausou/tocou a música.');
    io.emit('player:pause'); 
  });
  
  socket.on('admin:controlVolume', ({ volume }) => {
    currentVolume = parseInt(volume, 10);
    isMuted = (currentVolume === 0);
    
    console.log(`Admin definiu o volume para: ${currentVolume} (Mudo: ${isMuted})`);
    
    io.emit('admin:updateVolume', { volume: currentVolume, isMuted: isMuted });
    io.emit('player:setVolume', { volume: currentVolume, isMuted: isMuted });
  });


  // --- Desconexão ---
  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

// 🔹 Iniciar servidor
server.listen(PORT, () => {
  console.log(`🔥 Servidor rodando em http://localhost:${PORT}`);
});