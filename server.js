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
console.log('[System] Iniciando conexão com MongoDB...');
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB com sucesso!'))
  .catch((err) => console.error('❌ Erro CRÍTICO ao conectar ao MongoDB:', err));

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

// 5. Fila de Reprodução
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
let nowPlayingInfo = null;
let isCustomerPlaying = false;

// Helpers
async function getConfig() {
  try {
    let config = await ConfigModel.findOne({ key: 'main_config' });
    if (!config) {
      console.log('[DB] Configuração não encontrada, criando nova...');
      config = await ConfigModel.create({ key: 'main_config' });
    }
    return config;
  } catch (error) {
    console.error('[DB] Erro ao ler Config:', error);
    return { dailyRevenue: 0.0, currentPromoText: "Erro ao carregar", currentVolume: 50, isMuted: true };
  }
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
  try {
    const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 });
    
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
  } catch (err) {
    console.error('[Broadcast] Erro ao ler fila:', err);
  }
}

async function playNextInQueue() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  try {
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
      broadcastPlayerState();
  } catch (err) {
      console.error('[PlayNext] Erro ao processar fila:', err);
  }
}

async function startInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  try {
    const queueCount = await QueueModel.countDocuments();
    if (nowPlayingInfo || queueCount > 0) return;

    console.log(`[Server] Timer de inatividade (${INACTIVITY_TIMEOUT/1000}s) iniciado...`);

    inactivityTimer = setTimeout(async () => {
      if (nowPlayingInfo) return;
      const countCheck = await QueueModel.countDocuments();
      if (countCheck > 0) return; 

      const inactivitySongs = await InactivityModel.find({});
      if (inactivitySongs.length > 0) {
        console.log('[Server] Inatividade detectada. Carregando lista do banco.');
        
        const itemsToInsert = inactivitySongs.map(song => ({
          videoId: song.videoId,
          title: song.title || '(Música da Casa)', 
          isCustomer: false,
          message: null,
          priority: 0 
        }));

        await QueueModel.insertMany(itemsToInsert);
        playNextInQueue();
      } else {
        console.log('[Server] Inatividade, mas banco de inatividade está vazio.');
        broadcastPlayerState();
      }
    }, INACTIVITY_TIMEOUT);
  } catch (err) {
    console.error('[Timer] Erro na inatividade:', err);
  }
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
        return res.json({ ok: true, results: cachedEntry.results });
    }

    // 2. API
    const result = await youtubeSearchApi.GetListByKeyword(query, false, 6);
    
    const items = result.items
      .filter(item => item.id && item.title)
      .map(item => ({
        id: item.id,
        title: item.title,
        channel: item.channel?.name ?? 'Canal Indefinido',
        thumbnail: item.thumbnail?.thumbnails?.[0]?.url || ''
      }));

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

        const customerVideos = dbPayment.videos.map(v => ({
          videoId: v.id, 
          title: v.title, 
          isCustomer: true, 
          message: dbPayment.message,
          priority: 1 
        }));

        await QueueModel.insertMany(customerVideos);

        if (customerVideos.length > 0) {
            io.emit('player:newOrderNotification', { title: customerVideos[0].title });
        }

        if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
           playNextInQueue();
        } else {
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
  
  let formattedQueue = [];
  try {
      const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 });
      formattedQueue = queue.map(item => ({ id: item.videoId, title: item.title, isCustomer: item.isCustomer, message: item.message }));
  } catch (e) {
      console.error('[Socket] Erro ao buscar fila inicial:', e);
  }
  
  socket.emit('updatePlayerState', { nowPlaying: nowPlayingInfo, queue: formattedQueue });
  socket.emit('player:updatePromoText', config.currentPromoText);
  
  socket.on('player:ready', async () => {
    const freshConfig = await getConfig();
    socket.emit('player:setInitialState', { 
      volume: freshConfig.currentVolume, 
      isMuted: freshConfig.isMuted 
    });
    socket.emit('player:updatePromoText', freshConfig.currentPromoText);
    
    if (!nowPlayingInfo) {
        try {
            const count = await QueueModel.countDocuments();
            if (count > 0) playNextInQueue();
            else startInactivityTimer();
        } catch(e) {}
    }
  });

  socket.on('player:videoEnded', () => playNextInQueue());
  socket.on('player:ping', () => console.log(`[Ping] Keep-alive: ${socket.id}`));

  // 🔥 [NOVO] Evento de Reação (Chuva de Emojis)
  socket.on('reaction', (emoji) => {
      // Repassa o emoji para todos os players conectados (TVs)
      io.emit('player:showReaction', emoji);
  });

  // Admin Events
  socket.on('admin:getList', async () => {
    console.log(`[Admin] Carregando dados para: ${socket.id}`);
    const freshConfig = await getConfig();
    
    try {
        const inactivityList = await InactivityModel.find({});
        const names = inactivityList.map(item => item.title);
        socket.emit('admin:loadInactivityList', names);
    } catch(e) {
        console.error('[Admin] Erro ao carregar inatividade:', e);
    }

    socket.emit('admin:updateRevenue', freshConfig.dailyRevenue);
    
    try {
        const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 });
        const formattedQueue = queue.map(item => ({ id: item.videoId, title: item.title, isCustomer: item.isCustomer, message: item.message }));
        socket.emit('admin:updatePlayerState', { nowPlaying: nowPlayingInfo, queue: formattedQueue });
    } catch(e){}

    socket.emit('admin:updateVolume', { volume: freshConfig.currentVolume, isMuted: freshConfig.isMuted });
    socket.emit('admin:loadPromoText', freshConfig.currentPromoText);
  });

  socket.on('admin:saveInactivityList', async (nameArray) => {
    console.log('[Admin] Solicitado salvar nova lista de inatividade...');
    const newItems = [];
    const names = Array.isArray(nameArray) ? nameArray : [];

    try {
        for (const name of names) {
            if(name.trim().length > 0) {
                const id = await fetchVideoIdByName(name);
                if (id) {
                    newItems.push({ title: name, videoId: id });
                } else {
                    console.warn(`[Admin] Falha ao achar ID para: ${name} (Ignorado)`);
                }
            }
        }

        if (newItems.length > 0) {
            await InactivityModel.deleteMany({}); 
            await InactivityModel.insertMany(newItems); 
            console.log(`[Admin] Lista salva com ${newItems.length} músicas.`);
        } else {
            console.warn('[Admin] Nenhuma música válida encontrada ou lista vazia enviada. Mantendo lista anterior.');
        }

        if (!isCustomerPlaying && !nowPlayingInfo) startInactivityTimer();

    } catch (err) {
        console.error('[Admin] Erro crítico ao salvar lista:', err);
    }
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
      try {
          await QueueModel.create({
              videoId: videoId,
              title: videoTitle,
              isCustomer: false,
              message: null,
              priority: 1
          });
          if (!nowPlayingInfo) playNextInQueue();
          else broadcastPlayerState();
      } catch(e) { console.error(e); }
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
