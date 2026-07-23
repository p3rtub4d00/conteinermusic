import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment } from "mercadopago";
import youtubeSearchApi from "youtube-search-api";
import mongoose from "mongoose";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

dotenv.config();
const scrypt = promisify(scryptCallback);

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
  isMuted: { type: Boolean, default: true },
  adminPasswordHash: String,
  adminPasswordChangedAt: Date,
  maxPlaybackMinutes: { type: Number, default: 5 },
  autoplayMode: { type: String, default: 'manual' }, // 'manual' ou 'playlist'
  playlistLink: { type: String, default: '' }, // Termo ou link de busca
  blockedKeywords: { type: [String], default: [] } // Lista de palavras/termos proibidos
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
  userPhone: String,
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
  userPhone: String,
  mpPaymentId: String,
  priority: { type: Number, default: 1 }, // 1 = Cliente/Admin, 0 = Inatividade
  createdAt: { type: Date, default: Date.now }
});
const QueueModel = mongoose.model('Queue', QueueSchema);

// 6. Histórico de músicas tocadas
const PlayHistorySchema = new mongoose.Schema({
  videoId: String,
  title: String,
  message: String,
  source: { type: String, enum: ['customer', 'admin', 'inactivity'], default: 'customer' },
  userPhone: String,
  mpPaymentId: String,
  playedAt: { type: Date, default: Date.now }
});
const PlayHistoryModel = mongoose.model('PlayHistory', PlayHistorySchema);


// --- Inicialização do Servidor ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

function safeTextEquals(value, expected) {
  const valueBuffer = Buffer.from(String(value));
  const expectedBuffer = Buffer.from(String(expected));
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return safeTextEquals(password, process.env.ADMIN_PASS || 'admin');
  const [salt, savedKey] = storedHash.split(':');
  if (!salt || !savedKey) return false;
  const derivedKey = await scrypt(password, salt, 64);
  const savedKeyBuffer = Buffer.from(savedKey, 'hex');
  return savedKeyBuffer.length === derivedKey.length && timingSafeEqual(savedKeyBuffer, derivedKey);
}

async function requireAdminAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Painel Admin"');
    return res.status(401).send('Acesso negado: senha necessária.');
  }

  const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  const separator = credentials.indexOf(':');
  const username = separator >= 0 ? credentials.slice(0, separator) : '';
  const password = separator >= 0 ? credentials.slice(separator + 1) : '';

  try {
    const config = await getConfig();
    const validUser = safeTextEquals(username, process.env.ADMIN_USER || 'admin');
    const validPassword = await verifyPassword(password, config.adminPasswordHash);
    if (validUser && validPassword) return next();
  } catch (error) {
    console.error('[Admin] Erro ao validar credenciais:', error);
  }

  res.set('WWW-Authenticate', 'Basic realm="Painel Admin"');
  return res.status(401).send('Credenciais rejeitadas.');
}

app.use('/admin.html', requireAdminAuth);

app.post('/admin/change-password', requireAdminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ ok: false, error: 'Dados inválidos.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    }

    const config = await getConfig();
    if (!await verifyPassword(currentPassword, config.adminPasswordHash)) {
      return res.status(403).json({ ok: false, error: 'Senha atual incorreta.' });
    }

    config.adminPasswordHash = await hashPassword(newPassword);
    config.adminPasswordChangedAt = new Date();
    await config.save();
    console.log('[Admin] Senha do painel alterada.');
    return res.json({ ok: true });
  } catch (error) {
    console.error('[Admin] Erro ao alterar senha:', error);
    return res.status(500).json({ ok: false, error: 'Não foi possível alterar a senha.' });
  }
});

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// Configuração do Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// --- Variáveis de Estado em Memória ---
const INACTIVITY_TIMEOUT = 5000;
let inactivityTimer = null;
let customerPlaybackTimer = null; 
let nowPlayingInfo = null;
let isCustomerPlaying = false;
let isAdvancingQueue = false;

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
    return {
      dailyRevenue: 0.0,
      currentPromoText: "Erro ao carregar",
      currentVolume: 50,
      isMuted: true,
      maxPlaybackMinutes: 5,
      autoplayMode: 'manual',
      playlistLink: '',
      blockedKeywords: []
    };
  }
}

// --- Função de Filtro de Palavras Proibidas ---
async function isTitleBlocked(title) {
  if (!title) return false;
  try {
    const config = await getConfig();
    if (!config.blockedKeywords || config.blockedKeywords.length === 0) return false;
    const lowerTitle = title.toLowerCase();
    return config.blockedKeywords.some(keyword => {
      const kw = keyword.toLowerCase().trim();
      return kw.length > 0 && lowerTitle.includes(kw);
    });
  } catch (e) {
    return false;
  }
}

async function fetchVideoIdByName(name) {
  if (!name) return null;
  try {
    if (await isTitleBlocked(name)) return null;
    const result = await youtubeSearchApi.GetListByKeyword(name, false, 1);
    if (result && result.items && result.items.length > 0 && result.items[0].id) {
      const video = result.items[0];
      if (await isTitleBlocked(video.title)) return null;
      return video.id;
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
    const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 }).lean(); 
    
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
  if (isAdvancingQueue) {
    console.log('[Server] Avanço da fila já em andamento; evento duplicado ignorado.');
    return;
  }
  isAdvancingQueue = true;

  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  if (customerPlaybackTimer) {
    clearTimeout(customerPlaybackTimer);
    customerPlaybackTimer = null;
  }

  try {
      const nextVideo = await QueueModel.findOneAndDelete({}, { sort: { priority: -1, createdAt: 1 } });

      if (nextVideo) {
        if (nextVideo.isCustomer && nextVideo.mpPaymentId) {
          const songsFromSameOrder = await QueueModel.find({
            mpPaymentId: nextVideo.mpPaymentId,
            isCustomer: true
          }).sort({ createdAt: 1 }).select('_id videoId').lean();

          const seenVideoIds = new Set([nextVideo.videoId]);
          const duplicateIds = songsFromSameOrder
            .filter(song => {
              if (seenVideoIds.has(song.videoId)) return true;
              seenVideoIds.add(song.videoId);
              return false;
            })
            .map(song => song._id);

          if (duplicateIds.length > 0) {
            await QueueModel.deleteMany({ _id: { $in: duplicateIds } });
            console.log(`[Server] ${duplicateIds.length} música(s) duplicada(s) removida(s) do pedido ${nextVideo.mpPaymentId}.`);
          }
        }

        const source = nextVideo.isCustomer
          ? 'customer'
          : (nextVideo.priority === 0 ? 'inactivity' : 'admin');

        await PlayHistoryModel.create({
          videoId: nextVideo.videoId,
          title: nextVideo.title,
          message: nextVideo.message || null,
          source,
          userPhone: nextVideo.userPhone || null,
          mpPaymentId: nextVideo.mpPaymentId || null
        });

        nowPlayingInfo = {
            id: nextVideo.videoId,
            title: nextVideo.title,
            message: nextVideo.message,
            isCustomer: nextVideo.isCustomer
        };
        isCustomerPlaying = nowPlayingInfo.isCustomer;
        console.log(`[Server] Tocando: ${nowPlayingInfo.title} | É cliente? ${isCustomerPlaying}`);
        
        if (isCustomerPlaying) {
          const config = await getConfig();
          const maxMinutes = config.maxPlaybackMinutes || 5;
          const maxMs = maxMinutes * 60 * 1000;
          console.log(`[Server] Limitando música de cliente a ${maxMinutes} minuto(s).`);
          
          customerPlaybackTimer = setTimeout(() => {
            console.log(`[Server] Tempo limite de ${maxMinutes} min atingido para cliente. Pulando música.`);
            playNextInQueue();
          }, maxMs);
        } else {
          console.log(`[Server] Música da Casa / Autoplay rodando livre sem limite de tempo.`);
        }

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
  } finally {
      isAdvancingQueue = false;
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

      const config = await getConfig();

      if (config.autoplayMode === 'playlist' && config.playlistLink) {
          console.log(`[Server] Buscando música automática por termo: ${config.playlistLink}`);
          try {
              const searchResult = await youtubeSearchApi.GetListByKeyword(config.playlistLink, false, 15);
              
              if (searchResult && searchResult.items && searchResult.items.length > 0) {
                  const validVideos = [];
                  for (const item of searchResult.items) {
                      if (item.id && item.title && !(await isTitleBlocked(item.title))) {
                          validVideos.push(item);
                      }
                  }

                  if (validVideos.length > 0) {
                      const randomVideo = validVideos[Math.floor(Math.random() * validVideos.length)];
                      
                      await QueueModel.create({
                          videoId: randomVideo.id,
                          title: randomVideo.title,
                          isCustomer: false,
                          message: null,
                          priority: 0 
                      });
                      
                      playNextInQueue();
                      return;
                  }
              }
          } catch (err) {
              console.error('[Server] Erro na busca dinâmica por gênero:', err);
          }
      }

      const inactivitySongs = await InactivityModel.find({}).lean(); 
      if (inactivitySongs.length > 0) {
        console.log('[Server] Inatividade detectada. Carregando lista manual do banco.');
        const itemsToInsert = [];
        for (const song of inactivitySongs) {
            if (!(await isTitleBlocked(song.title))) {
                itemsToInsert.push({
                  videoId: song.videoId,
                  title: song.title || '(Música da Casa)', 
                  isCustomer: false,
                  message: null,
                  priority: 0 
                });
            }
        }

        if (itemsToInsert.length > 0) {
            await QueueModel.insertMany(itemsToInsert);
            playNextInQueue();
        } else {
            broadcastPlayerState();
        }
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

app.get("/user-history", async (req, res) => {
    try {
        const phone = req.query.phone;
        if (!phone) return res.json({ ok: true, history: [] });

        const payments = await PaymentModel.find({ 
            userPhone: phone, 
            status: 'approved' 
        }).sort({ createdAt: -1 }).limit(30);

        const uniqueVideos = new Map();
        payments.forEach(p => {
            if(p.videos) {
                p.videos.forEach(v => {
                    if(!uniqueVideos.has(v.id)) {
                        uniqueVideos.set(v.id, {
                            id: v.id,
                            title: v.title,
                            thumbnail: v.thumbnail
                        });
                    }
                });
            }
        });

        res.json({ ok: true, history: Array.from(uniqueVideos.values()) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'Erro ao buscar histórico' });
    }
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ ok: false, error: "Consulta inválida" });

    const lowerQuery = query.toLowerCase().trim();

    const cachedEntry = await SearchCacheModel.findOne({ term: lowerQuery }).lean();
    if (cachedEntry) {
        return res.json({ ok: true, results: cachedEntry.results });
    }

    const result = await youtubeSearchApi.GetListByKeyword(query, false, 8);
    
    const items = [];
    for (const item of result.items) {
      if (item.id && item.title) {
        if (!(await isTitleBlocked(item.title))) {
          items.push({
            id: item.id,
            title: item.title,
            channel: item.channel?.name ?? 'Canal Indefinido',
            thumbnail: item.thumbnail?.thumbnails?.[0]?.url || ''
          });
        }
      }
    }

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
    const { videos, amount, description, message, socketId, userPhone } = req.body;
    if (!videos || !amount || !socketId) return res.status(400).json({ ok: false, error: "Dados inválidos." });

    // Valida se algum vídeo contém palavra bloqueada antes de cobrar
    for (const v of videos) {
        if (await isTitleBlocked(v.title)) {
            return res.status(400).json({ ok: false, error: `A música "${v.title}" não é permitida pelo estabelecimento.` });
        }
    }

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
      userPhone: userPhone,
      amount: Number(amount),
      description: description,
      message: message,
      status: 'pending',
      videos: videos
    });
    console.log(`[Server] Pagamento ${result.id} criado.`);

    res.json({
      ok: true,
      paymentId: result.id.toString(),
      qr: result.point_of_interaction.transaction_data.qr_code_base64,
      copiaCola: result.point_of_interaction.transaction_data.qr_code
    });
  } catch (err) {
    console.error("[Server] Erro Create-Payment:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) return res.status(400).json({ ok: false, error: 'paymentId obrigatório' });

    const payment = await PaymentModel.findOne({ mpPaymentId: paymentId.toString() }).select('status').lean();
    if (!payment) return res.status(404).json({ ok: false, error: 'Pagamento não encontrado' });

    res.json({ ok: true, status: payment.status });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Erro ao consultar pagamento' });
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
      const dbPayment = await PaymentModel.findOneAndUpdate(
        { mpPaymentId: paymentId.toString(), status: { $ne: 'approved' } },
        { $set: { status: 'approved' } },
        { new: true }
      );

      if (dbPayment) {
        console.log(`[Server] Pagamento ${paymentId} APROVADO via Webhook.`);

        const config = await getConfig();
        config.dailyRevenue += dbPayment.amount;
        await config.save();
        io.emit('admin:updateRevenue', config.dailyRevenue);

        isCustomerPlaying = true;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = null;

        const customerVideos = [];
        for (const v of dbPayment.videos) {
            if (!(await isTitleBlocked(v.title))) {
                customerVideos.push({
                  videoId: v.id, 
                  title: v.title, 
                  isCustomer: true, 
                  message: dbPayment.message,
                  userPhone: dbPayment.userPhone || null,
                  mpPaymentId: dbPayment.mpPaymentId || null,
                  priority: 1 
                });
            }
        }

        if (customerVideos.length > 0) {
            await QueueModel.insertMany(customerVideos);
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
  
  socket.on('player:ready', async () => {
    const [freshConfig, queue] = await Promise.all([
        getConfig(),
        QueueModel.find({}).sort({ priority: -1, createdAt: 1 }).lean()
    ]);

    socket.emit('updatePlayerState', { 
        nowPlaying: nowPlayingInfo, 
        queue: queue.map(item => ({ id: item.videoId, title: item.title, isCustomer: item.isCustomer, message: item.message }))
    });
    
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
  socket.on('player:ping', () => {
    socket.emit('player:pong', { ts: Date.now() });
  });

  socket.on('reaction', (emoji) => {
      io.emit('player:showReaction', emoji);
  });

  socket.on('admin:getList', async () => {
    try {
        const [freshConfig, inactivityList, queue, playHistory] = await Promise.all([
            getConfig(),
            InactivityModel.find({}).select('title videoId').lean(),
            QueueModel.find({}).sort({ priority: -1, createdAt: 1 }).lean(),
            PlayHistoryModel.find({}).sort({ playedAt: -1 }).limit(100).lean()
        ]);

        const inactivityItems = inactivityList.map(item => ({ title: item.title, videoId: item.videoId }));
        
        socket.emit('admin:loadInactivityList', inactivityItems);
        socket.emit('admin:updateRevenue', freshConfig.dailyRevenue);
        socket.emit('admin:updateVolume', { volume: freshConfig.currentVolume, isMuted: freshConfig.isMuted });
        socket.emit('admin:loadPromoText', freshConfig.currentPromoText);
        socket.emit('admin:playHistory', playHistory);

        socket.emit('admin:loadAutoplayConfig', { 
            mode: freshConfig.autoplayMode, 
            playlistLink: freshConfig.playlistLink 
        });
        socket.emit('admin:updateMaxPlaybackMinutes', freshConfig.maxPlaybackMinutes);
        socket.emit('admin:loadBlockedKeywords', freshConfig.blockedKeywords || []);

        const formattedQueue = queue.map(item => ({ 
            id: item.videoId, 
            title: item.title, 
            isCustomer: item.isCustomer, 
            message: item.message 
        }));
        socket.emit('admin:updatePlayerState', { nowPlaying: nowPlayingInfo, queue: formattedQueue });

    } catch(e) {
        console.error('[Admin] Erro ao carregar dados:', e);
    }
  });

  socket.on('admin:getPlayHistory', async () => {
    try {
      const playHistory = await PlayHistoryModel.find({}).sort({ playedAt: -1 }).limit(100).lean();
      socket.emit('admin:playHistory', playHistory);
    } catch (e) {
      socket.emit('admin:playHistory', []);
    }
  });

  socket.on('admin:resetRevenue', async (callback) => {
    try {
      const config = await getConfig();
      config.dailyRevenue = 0;
      await config.save();
      io.emit('admin:updateRevenue', config.dailyRevenue);
      if (typeof callback === 'function') callback({ ok: true });
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false });
    }
  });

  socket.on('admin:saveInactivityList', async (itemArray, callback) => {
    const newItems = [];
    const failedTitles = [];
    const items = Array.isArray(itemArray) ? itemArray : [];

    try {
        for (const item of items) {
            const name = typeof item === 'string' ? item.trim() : String(item?.title || '').trim();
            if (name.length > 0 && !(await isTitleBlocked(name))) {
                const id = typeof item === 'object' && item.videoId ? item.videoId : await fetchVideoIdByName(name);
                if (id) {
                  newItems.push({ title: name, videoId: id });
                } else {
                  failedTitles.push(name);
                }
            }
        }

        await InactivityModel.deleteMany({});
        if (newItems.length > 0) {
            await InactivityModel.insertMany(newItems); 
        }

        if (!isCustomerPlaying && !nowPlayingInfo) startInactivityTimer();
        const result = { ok: true, saved: newItems.length, failedTitles, items: newItems };
        socket.emit('admin:inactivityListSaved', result);
        if (typeof callback === 'function') callback(result);

    } catch (err) {
        const result = { ok: false, error: 'Não foi possível salvar a lista.' };
        socket.emit('admin:inactivityListSaved', result);
        if (typeof callback === 'function') callback(result);
    }
  });

  socket.on('admin:searchForInactivityList', async (query) => {
      try {
        if (await isTitleBlocked(query)) {
            return socket.emit('admin:inactivitySearchResults', []);
        }
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = [];
        for (const i of result.items) {
            if (!(await isTitleBlocked(i.title))) {
                items.push({ id: i.id, title: i.title, channel: i.channel?.name });
            }
        }
        socket.emit('admin:inactivitySearchResults', items);
      } catch(e) { socket.emit('admin:inactivitySearchResults', []); }
  });

  socket.on('admin:search', async (query) => {
      try {
        if (await isTitleBlocked(query)) {
            return socket.emit('admin:searchResults', []);
        }
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = [];
        for (const i of result.items) {
            if (!(await isTitleBlocked(i.title))) {
                items.push({ id: i.id, title: i.title, channel: i.channel?.name });
            }
        }
        socket.emit('admin:searchResults', items);
      } catch(e) { socket.emit('admin:searchResults', []); }
  });

  socket.on('admin:addVideo', async ({ videoId, videoTitle }) => {
    if (videoId) {
      if (await isTitleBlocked(videoTitle)) return;
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
      } catch(e) {}
    }
  });

  socket.on('admin:setAutoplayMode', async (mode) => {
      const config = await getConfig();
      config.autoplayMode = mode;
      await config.save();
  });

  socket.on('admin:savePlaylistLink', async (link, callback) => {
      const config = await getConfig();
      config.playlistLink = link;
      config.autoplayMode = 'playlist';
      await config.save();
      
      await QueueModel.deleteMany({ priority: 0 });

      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
          playNextInQueue();
      } else if (!nowPlayingInfo) {
          startInactivityTimer();
      }

      broadcastPlayerState();
      if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('admin:setMaxPlaybackMinutes', async ({ minutes }) => {
      const config = await getConfig();
      config.maxPlaybackMinutes = minutes;
      await config.save();
  });

  // --- Gerenciamento de Palavras Bloqueadas via Admin ---
  socket.on('admin:saveBlockedKeywords', async (keywordsArray, callback) => {
      try {
          const config = await getConfig();
          const cleanKeywords = Array.isArray(keywordsArray) 
              ? keywordsArray.map(k => String(k).trim()).filter(k => k.length > 0)
              : [];
          
          config.blockedKeywords = cleanKeywords;
          await config.save();

          io.emit('admin:loadBlockedKeywords', cleanKeywords);
          if (typeof callback === 'function') callback({ ok: true, keywords: cleanKeywords });
      } catch (err) {
          if (typeof callback === 'function') callback({ ok: false, error: 'Erro ao salvar palavras bloqueadas.' });
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
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
