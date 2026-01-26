import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment } from "mercadopago";
import youtubeSearchApi from "youtube-search-api";
import mongoose from "mongoose";
import basicAuth from "express-basic-auth";

dotenv.config();

// --- Configuração do MongoDB / Mongoose ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB com sucesso!'))
  .catch((err) => console.error('❌ Erro ao conectar ao MongoDB:', err));

// --- Schemas (Modelos de Dados) ---

// 1. Configurações Globais
const ConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'main_config', unique: true },
  dailyRevenue: { type: Number, default: 0.0 },
  currentPromoText: { type: String, default: "Bem-vindo ao Contêiner Music Box!" },
  currentVolume: { type: Number, default: 50 },
  isMuted: { type: Boolean, default: true }
});
const ConfigModel = mongoose.model('Config', ConfigSchema);

// 2. Lista de Inatividade
const InactivitySongSchema = new mongoose.Schema({
  title: String,
  videoId: String,
  channel: String
});
const InactivityModel = mongoose.model('InactivitySong', InactivitySongSchema);

// 3. Pagamentos
const PaymentSchema = new mongoose.Schema({
  mpPaymentId: { type: String, unique: true },
  socketId: String,
  amount: Number,
  description: String,
  message: String,
  status: { type: String, default: 'pending' },
  videos: [{
      id: String,
      title: String,
      channel: String,
      thumbnail: String
  }],
  createdAt: { type: Date, default: Date.now }
});
const PaymentModel = mongoose.model('Payment', PaymentSchema);

// 4. Cache de Busca
const SearchCacheSchema = new mongoose.Schema({
  term: { type: String, unique: true },
  results: Array, 
  createdAt: { type: Date, default: Date.now, expires: 86400 } // Expira em 24h
});
const SearchCacheModel = mongoose.model('SearchCache', SearchCacheSchema);

// 5. [NOVO] Fila de Reprodução (Persistente)
const QueueSchema = new mongoose.Schema({
  videoId: String,
  title: String,
  isCustomer: { type: Boolean, default: false },
  message: String,
  priority: { type: Number, default: 1 }, // 1 = Cliente/Admin, 0 = Inatividade
  createdAt: { type: Date, default: Date.now }
});
const QueueModel = mongoose.model('Queue', QueueSchema);


// --- Inicialização do Servidor ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// 🔒 SEGURANÇA DO ADMIN 🔒
app.use('/admin.html', basicAuth({
    users: { 
        [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASS || 'admin' 
    },
    challenge: true,
    unauthorizedResponse: (req) => {
        return req.auth 
            ? 'Credenciais rejeitadas' 
            : 'Acesso negado: Você precisa de senha para acessar o painel de controle.';
    }
}));

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// Configuração do Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// --- Variáveis de Estado em Memória ---
const INACTIVITY_TIMEOUT = 5000;
let inactivityTimer = null;
// let mainQueue = []; // REMOVIDO: Agora usamos QueueModel
let nowPlayingInfo = null;
let isCustomerPlaying = false;

// Helpers
async function getConfig() {
  let config = await ConfigModel.findOne({ key: 'main_config' });
  if (!config) {
    config = await ConfigModel.create({ key: 'main_config' });
  }
  return config;
}

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

// Controle do Player
async function broadcastPlayerState() {
  // Busca fila do banco, ordenada por prioridade (maior primeiro) e depois chegada
  const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 });
  
  // Mapeia para o formato que o front espera
  const formattedQueue = queue.map(item => ({
      id: item.videoId,
      title: item.title,
      isCustomer: item.isCustomer,
      message: item.message
  }));

  const state = {
    nowPlaying: nowPlayingInfo,
    queue: formattedQueue
  };
  io.emit('updatePlayerState', state);
}

async function playNextInQueue() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  // Busca o próximo item do banco (tira da fila)
  const nextVideo = await QueueModel.findOneAndDelete({}, { sort: { priority: -1, createdAt: 1 } });

  if (nextVideo) {
    nowPlayingInfo = {
        id: nextVideo.videoId,
        title: nextVideo.title,
        message: nextVideo.message,
        isCustomer: nextVideo.isCustomer
    };
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
  broadcastPlayerState(); // Atualiza a tela de todos
}

async function startInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  // Verifica se realmente está vazio (BD e memória)
  const queueCount = await QueueModel.countDocuments();
  if (nowPlayingInfo || queueCount > 0) return;

  console.log(`[Server] Timer de inatividade (${INACTIVITY_TIMEOUT/1000}s) iniciado...`);

  inactivityTimer = setTimeout(async () => {
    if (nowPlayingInfo) return;
    const countCheck = await QueueModel.countDocuments();
    if (countCheck > 0) return; // Chegou algo nesse meio tempo

    const inactivitySongs = await InactivityModel.find({});
    if (inactivitySongs.length > 0) {
      console.log('[Server] Inatividade detectada. Carregando lista do banco.');
      
      // Insere as músicas de inatividade no banco com Prioridade 0
      const itemsToInsert = inactivitySongs.map(song => ({
        videoId: song.videoId,
        title: song.title || '(Música da Casa)', 
        isCustomer: false,
        message: null,
        priority: 0 // Prioridade Baixa
      }));

      await QueueModel.insertMany(itemsToInsert);
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

    const lowerQuery = query.toLowerCase().trim();

    // 1. Cache
    const cachedEntry = await SearchCacheModel.findOne({ term: lowerQuery });
    if (cachedEntry) {
        console.log(`[Cache] Retornando resultados para: "${lowerQuery}"`);
        return res.json({ ok: true, results: cachedEntry.results });
    }

    // 2. API
    console.log(`[API] Buscando no YouTube: "${lowerQuery}"`);
    const result = await youtubeSearchApi.GetListByKeyword(query, false, 6);
    
    const items = result.items
      .filter(item => item.id && item.title)
      .map(item => ({
        id: item.id,
        title: item.title,
        channel: item.channel?.name ?? 'Canal Indefinido',
        thumbnail: item.thumbnail?.thumbnails?.[0]?.url || ''
      }));

    // 3. Salvar Cache
    if (items.length > 0) {
        await SearchCacheModel.create({ term: lowerQuery, results: items });
    }
    res.json({ ok: true, results: items });

  } catch (err) {
    console.error("[Search] Erro:", err.message);
    res.status(500).json({ ok: false, error: "Erro interno na busca" });
  }
});

app.post("/create-payment", async (req, res) => {
  try {
    const { videos, amount, description, message, socketId } = req.body;
    if (!videos || !amount || !socketId) return res.status(400).json({ ok: false, error: "Dados inválidos." });

    const notification_url = "https://conteinermusic.onrender.com/webhook"; 

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

    await PaymentModel.create({
      mpPaymentId: result.id.toString(), 
      socketId: socketId,
      amount: Number(amount),
      description: description,
      message: message,
      status: 'pending',
      videos: videos
    });
    console.log(`[Server] Pagamento ${result.id} criado.`);

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

    const payment = new Payment(mpClient);
    const mpPayment = await payment.get({ id: paymentId });

    if (mpPayment.status === 'approved') {
      const dbPayment = await PaymentModel.findOne({ mpPaymentId: paymentId.toString() });

      if (dbPayment && dbPayment.status !== 'approved') {
        console.log(`[Server] Pagamento ${paymentId} APROVADO via Webhook.`);
        dbPayment.status = 'approved';
        await dbPayment.save();

        const config = await getConfig();
        config.dailyRevenue += dbPayment.amount;
        await config.save();
        io.emit('admin:updateRevenue', config.dailyRevenue);

        isCustomerPlaying = true;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = null;

        // Prepara os vídeos para inserir no Banco
        const customerVideos = dbPayment.videos.map(v => ({
          videoId: v.id, 
          title: v.title, 
          isCustomer: true, 
          message: dbPayment.message,
          priority: 1 // Prioridade Alta (Cliente)
        }));

        await QueueModel.insertMany(customerVideos);

        // Lógica de interrupção / tocar agora
        if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
           // Se está tocando música da casa, interrompe e toca a do cliente
           playNextInQueue();
        } else {
           // Se já está tocando cliente ou nada, apenas avisa que fila mudou
           if (!nowPlayingInfo) playNextInQueue();
           else broadcastPlayerState();
        }

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
  const config = await getConfig();
  
  // Manda estado atual (agora buscando do banco dentro da função broadcast)
  const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 });
  const formattedQueue = queue.map(item => ({ id: item.videoId, title: item.title, isCustomer: item.isCustomer, message: item.message }));
  
  socket.emit('updatePlayerState', { nowPlaying: nowPlayingInfo, queue: formattedQueue });
  socket.emit('player:updatePromoText', config.currentPromoText);
  
  socket.on('player:ready', async () => {
    const freshConfig = await getConfig();
    socket.emit('player:setInitialState', { 
      volume: freshConfig.currentVolume, 
      isMuted: freshConfig.isMuted 
    });
    socket.emit('player:updatePromoText', freshConfig.currentPromoText);
    
    // Recuperação após restart: Se não tá tocando nada, checa o banco
    if (!nowPlayingInfo) {
        const count = await QueueModel.countDocuments();
        if (count > 0) playNextInQueue();
        else startInactivityTimer();
    }
  });

  socket.on('player:videoEnded', () => playNextInQueue());

  socket.on('player:ping', () => {
    console.log(`[Ping] Keep-alive recebido do player: ${socket.id}`);
  });

  // Admin Events
  socket.on('admin:getList', async () => {
    const freshConfig = await getConfig();
    const inactivityList = await InactivityModel.find({});
    const names = inactivityList.map(item => item.title);

    socket.emit('admin:loadInactivityList', names);
    socket.emit('admin:updateRevenue', freshConfig.dailyRevenue);
    
    // Atualiza estado do player pro admin
    const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 });
    const formattedQueue = queue.map(item => ({ id: item.videoId, title: item.title, isCustomer: item.isCustomer, message: item.message }));
    socket.emit('admin:updatePlayerState', { nowPlaying: nowPlayingInfo, queue: formattedQueue });

    socket.emit('admin:updateVolume', { volume: freshConfig.currentVolume, isMuted: freshConfig.isMuted });
    socket.emit('admin:loadPromoText', freshConfig.currentPromoText);
  });

  socket.on('admin:saveInactivityList', async (nameArray) => {
    await InactivityModel.deleteMany({});
    const names = Array.isArray(nameArray) ? nameArray : [];
    const newItems = [];
    for (const name of names) {
      if(name.trim().length > 0) {
         const id = await fetchVideoIdByName(name);
         if (id) newItems.push({ title: name, videoId: id });
      }
    }
    if (newItems.length > 0) await InactivityModel.insertMany(newItems);
    if (!isCustomerPlaying && !nowPlayingInfo) startInactivityTimer();
  });

  socket.on('admin:searchForInactivityList', async (query) => {
      try {
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = result.items.map(i => ({ id: i.id, title: i.title, channel: i.channel?.name }));
        socket.emit('admin:inactivitySearchResults', items);
      } catch(e) { socket.emit('admin:inactivitySearchResults', []); }
  });

  socket.on('admin:search', async (query) => {
      try {
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = result.items.map(i => ({ id: i.id, title: i.title, channel: i.channel?.name }));
        socket.emit('admin:searchResults', items);
      } catch(e) { socket.emit('admin:searchResults', []); }
  });

  socket.on('admin:addVideo', async ({ videoId, videoTitle }) => {
    if (videoId) {
      // Salva no banco com prioridade 1 (Admin/Cliente)
      await QueueModel.create({
          videoId: videoId,
          title: videoTitle,
          isCustomer: false,
          message: null,
          priority: 1
      });

      if (!nowPlayingInfo) playNextInQueue();
      else broadcastPlayerState();
    }
  });

  socket.on('admin:setPromoText', async (text) => {
    const config = await getConfig();
    config.currentPromoText = text;
    await config.save();
    io.emit('player:updatePromoText', text);
    io.emit('admin:loadPromoText', text);
  });

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
  console.log(`🔥 Servidor COMPLETO rodando na porta ${PORT}`);
});
