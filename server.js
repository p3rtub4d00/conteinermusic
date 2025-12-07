import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment } from "mercadopago";
import youtubeSearchApi from "youtube-search-api";
import mongoose from "mongoose";

dotenv.config();

// --- Configuração do MongoDB / Mongoose ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB com sucesso!'))
  .catch((err) => console.error('❌ Erro ao conectar ao MongoDB:', err));

// --- Schemas (Modelos de Dados) ---

// 1. Configurações Globais (Volume, Texto Promo, Faturamento)
const ConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'main_config', unique: true }, // Garante apenas 1 doc de config
  dailyRevenue: { type: Number, default: 0.0 },
  currentPromoText: { type: String, default: "Bem-vindo ao Contêiner Music Box!" },
  currentVolume: { type: Number, default: 50 },
  isMuted: { type: Boolean, default: true }
});
const ConfigModel = mongoose.model('Config', ConfigSchema);

// 2. Lista de Inatividade (Autoplay)
const InactivitySongSchema = new mongoose.Schema({
  title: String,
  videoId: String,
  channel: String
});
const InactivityModel = mongoose.model('InactivitySong', InactivitySongSchema);

// 3. Pagamentos (Substitui o objeto em memória)
const PaymentSchema = new mongoose.Schema({
  mpPaymentId: { type: String, unique: true }, // ID do Mercado Pago
  socketId: String,
  amount: Number,
  description: String,
  message: String,
  status: { type: String, default: 'pending' }, // pending, approved, rejected
  videos: [ // Array de vídeos solicitados
    {
      id: String,
      title: String,
      channel: String,
      thumbnail: String
    }
  ],
  createdAt: { type: Date, default: Date.now }
});
const PaymentModel = mongoose.model('Payment', PaymentSchema);


// --- Inicialização do Servidor ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// Configuração do Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// --- Variáveis de Estado em Memória (Fila ativa permanece em memória para performance) ---
const INACTIVITY_TIMEOUT = 5000;
let inactivityTimer = null;
let mainQueue = []; // { id, title, isCustomer, message? }
let nowPlayingInfo = null;
let isCustomerPlaying = false;

// Helper: Obter ou criar configurações iniciais
async function getConfig() {
  let config = await ConfigModel.findOne({ key: 'main_config' });
  if (!config) {
    config = await ConfigModel.create({ key: 'main_config' });
  }
  return config;
}

// Helper: Buscar ID do YouTube
async function fetchVideoIdByName(name) {
  if (!name) return null;
  try {
    const result = await youtubeSearchApi.GetListByKeyword(name, false, 1);
    if (result && result.items && result.items.length > 0 && result.items[0].id) {
      return result.items[0].id;
    }
    return null;
  } catch (err) {
    console.error(`Erro ao buscar ID para "${name}":`, err.message);
    return null;
  }
}

// --- Funções de Controle do Player ---

function broadcastPlayerState() {
  const state = {
    nowPlaying: nowPlayingInfo,
    queue: mainQueue
  };
  io.emit('updatePlayerState', state);
}

async function playNextInQueue() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  if (mainQueue.length > 0) {
    nowPlayingInfo = mainQueue.shift();
    isCustomerPlaying = nowPlayingInfo.isCustomer;

    console.log(`[Server] Tocando: ${nowPlayingInfo.title}`);
    
    io.emit('player:playVideo', {
      videoId: nowPlayingInfo.id,
      title: nowPlayingInfo.title,
      message: nowPlayingInfo.message
    });

  } else {
    console.log('[Server] Fila vazia.');
    nowPlayingInfo = null;
    isCustomerPlaying = false;
    startInactivityTimer();
  }
  broadcastPlayerState();
}

function startInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  if (nowPlayingInfo || mainQueue.length > 0) return;

  console.log(`[Server] Timer de inatividade (${INACTIVITY_TIMEOUT/1000}s) iniciado...`);

  inactivityTimer = setTimeout(async () => {
    if (nowPlayingInfo || mainQueue.length > 0) return;

    // Buscar lista do MongoDB
    const inactivitySongs = await InactivityModel.find({});

    if (inactivitySongs.length > 0) {
      console.log('[Server] Inatividade detectada. Carregando lista do banco.');
      
      // Converte para o formato da fila
      mainQueue = inactivitySongs.map(song => ({
        id: song.videoId,
        title: song.title || '(Música da Casa)', // Usa o título salvo ou padrão
        isCustomer: false,
        message: null
      }));

      playNextInQueue();
    } else {
      console.log('[Server] Inatividade, mas banco de inatividade está vazio.');
      broadcastPlayerState();
    }
  }, INACTIVITY_TIMEOUT);
}

// --- Rotas HTTP ---

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ ok: false, error: "Consulta inválida" });

    const result = await youtubeSearchApi.GetListByKeyword(query, false, 6);
    const items = result.items
      .filter(item => item.id && item.title)
      .map(item => ({
        id: item.id,
        title: item.title,
        channel: item.channel?.name ?? 'Canal Indefinido',
        thumbnail: item.thumbnail?.thumbnails?.[0]?.url || ''
      }));

    res.json({ ok: true, results: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Erro interno na busca" });
  }
});

app.post("/create-payment", async (req, res) => {
  try {
    const { videos, amount, description, message, socketId } = req.body;

    if (!videos || !amount || !socketId) {
      return res.status(400).json({ ok: false, error: "Dados inválidos." });
    }

    const notification_url = "https://conteinermusic.onrender.com/webhook"; // ALTERE SE NECESSÁRIO

    const payment_data = {
      transaction_amount: Number(amount),
      description: description,
      payment_method_id: "pix",
      payer: { email: "pagador@email.com" },
      notification_url: notification_url
    };

    const payment = new Payment(mpClient);
    const result = await payment.create({ body: payment_data });

    if (!result?.point_of_interaction?.transaction_data?.qr_code_base64) {
      throw new Error('Falha ao gerar QR Code.');
    }

    // SALVAR NO MONGODB
    await PaymentModel.create({
      mpPaymentId: result.id.toString(), // Converter para string por segurança
      socketId: socketId,
      amount: Number(amount),
      description: description,
      message: message,
      status: 'pending',
      videos: videos
    });

    console.log(`[Server] Pagamento ${result.id} criado e salvo no MongoDB.`);

    res.json({
      ok: true,
      qr: result.point_of_interaction.transaction_data.qr_code_base64,
      copiaCola: result.point_of_interaction.transaction_data.qr_code
    });

  } catch (err) {
    console.error("[Server] Erro Create-Payment:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const notification = req.body;
    let paymentId = null;

    if (notification?.data?.id) paymentId = notification.data.id;
    else if (notification?.type === 'payment') paymentId = notification.data.id;
    else if (notification?.resource) {
        const parts = notification.resource.split('/');
        paymentId = parts[parts.length - 1];
    }

    if (!paymentId) return res.sendStatus(200);

    // Consulta status real no Mercado Pago
    const payment = new Payment(mpClient);
    const mpPayment = await payment.get({ id: paymentId });

    if (mpPayment.status === 'approved') {
      // Busca no MongoDB
      const dbPayment = await PaymentModel.findOne({ mpPaymentId: paymentId.toString() });

      if (dbPayment && dbPayment.status !== 'approved') {
        console.log(`[Server] Pagamento ${paymentId} APROVADO via Webhook.`);

        // 1. Atualiza Status
        dbPayment.status = 'approved';
        await dbPayment.save();

        // 2. Atualiza Faturamento no MongoDB
        const config = await getConfig();
        config.dailyRevenue += dbPayment.amount;
        await config.save();
        io.emit('admin:updateRevenue', config.dailyRevenue);

        // 3. Adiciona à Fila
        isCustomerPlaying = true;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = null;

        const customerVideos = dbPayment.videos.map(v => ({
          id: v.id,
          title: v.title,
          isCustomer: true,
          message: dbPayment.message
        }));

        if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
           // Interrompe música da casa
           mainQueue = [...customerVideos, ...mainQueue];
           playNextInQueue();
        } else {
           mainQueue.push(...customerVideos);
           if (!nowPlayingInfo) playNextInQueue();
           else broadcastPlayerState();
        }

        // 4. Notifica Cliente
        if (dbPayment.socketId) {
          const targetSocket = io.sockets.sockets.get(dbPayment.socketId);
          if (targetSocket) targetSocket.emit('paymentConfirmed');
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[Server] Webhook Error:", err);
    res.sendStatus(500);
  }
});

// --- Socket.IO ---

io.on("connection", async (socket) => {
  console.log("[Socket] Conectado:", socket.id);

  // Carrega configurações do banco ao conectar
  const config = await getConfig();
  
  // Envia estado inicial
  socket.emit('updatePlayerState', { nowPlaying: nowPlayingInfo, queue: mainQueue });
  socket.emit('player:updatePromoText', config.currentPromoText);
  
  // --- Player (TV) ---
  socket.on('player:ready', async () => {
    const freshConfig = await getConfig();
    socket.emit('player:setInitialState', { 
      volume: freshConfig.currentVolume, 
      isMuted: freshConfig.isMuted 
    });
    socket.emit('player:updatePromoText', freshConfig.currentPromoText);
    if (!nowPlayingInfo) startInactivityTimer();
  });

  socket.on('player:videoEnded', () => {
    playNextInQueue();
  });

  // --- Admin ---
  socket.on('admin:getList', async () => {
    const freshConfig = await getConfig();
    
    // Busca nomes da lista de inatividade do banco
    const inactivityList = await InactivityModel.find({});
    const names = inactivityList.map(item => item.title); // Retorna apenas os nomes para o textarea

    socket.emit('admin:loadInactivityList', names);
    socket.emit('admin:updateRevenue', freshConfig.dailyRevenue);
    socket.emit('admin:updatePlayerState', { nowPlaying: nowPlayingInfo, queue: mainQueue });
    socket.emit('admin:updateVolume', { volume: freshConfig.currentVolume, isMuted: freshConfig.isMuted });
    socket.emit('admin:loadPromoText', freshConfig.currentPromoText);
  });

  // Salvar Lista de Inatividade (Admin)
  socket.on('admin:saveInactivityList', async (nameArray) => {
    // 1. Limpa coleção atual
    await InactivityModel.deleteMany({});
    
    // 2. Resolve IDs e salva no banco
    const names = Array.isArray(nameArray) ? nameArray : [];
    const newItems = [];

    for (const name of names) {
      if(name.trim().length > 0) {
         const id = await fetchVideoIdByName(name);
         if (id) {
           newItems.push({ title: name, videoId: id });
         }
      }
    }

    if (newItems.length > 0) {
      await InactivityModel.insertMany(newItems);
      console.log(`[Admin] Salvos ${newItems.length} itens na inatividade.`);
    }

    if (!isCustomerPlaying && !nowPlayingInfo) startInactivityTimer();
  });

  // Busca para Inatividade (Admin)
  socket.on('admin:searchForInactivityList', async (query) => {
      try {
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = result.items.map(i => ({ id: i.id, title: i.title, channel: i.channel?.name }));
        socket.emit('admin:inactivitySearchResults', items);
      } catch(e) { socket.emit('admin:inactivitySearchResults', []); }
  });

  // Busca Normal (Admin)
  socket.on('admin:search', async (query) => {
      try {
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = result.items.map(i => ({ id: i.id, title: i.title, channel: i.channel?.name }));
        socket.emit('admin:searchResults', items);
      } catch(e) { socket.emit('admin:searchResults', []); }
  });

  // Adicionar Vídeo (Admin)
  socket.on('admin:addVideo', ({ videoId, videoTitle }) => {
    if (videoId) {
      mainQueue.push({ id: videoId, title: videoTitle, isCustomer: false, message: null });
      if (!nowPlayingInfo) playNextInQueue();
      else broadcastPlayerState();
    }
  });

  // Salvar Texto Promo (Admin)
  socket.on('admin:setPromoText', async (text) => {
    const config = await getConfig();
    config.currentPromoText = text;
    await config.save();
    
    io.emit('player:updatePromoText', text);
    io.emit('admin:loadPromoText', text);
  });

  // Controles
  socket.on('admin:controlPause', () => io.emit('player:pause'));
  socket.on('admin:controlSkip', () => playNextInQueue());

  socket.on('admin:controlVolume', async ({ volume }) => {
    const config = await getConfig();
    config.currentVolume = parseInt(volume);
    config.isMuted = (config.currentVolume === 0);
    await config.save();

    io.emit('admin:updateVolume', { volume: config.currentVolume, isMuted: config.isMuted });
    io.emit('player:setVolume', { volume: config.currentVolume, isMuted: config.isMuted });
  });

});

server.listen(PORT, () => {
  console.log(`🔥 Servidor MongoDB rodando na porta ${PORT}`);
});
