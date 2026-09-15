const { existsSync, unlinkSync, readdir } = require('fs');
const { join } = require('path');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { 
    DisconnectReason,
    useMultiFileAuthState,
    downloadMediaMessage,
    getUrlInfo,
    proto,
    decryptPollVote,
    getAggregateVotesInPollMessage,
    getKeyAuthor,
    jidNormalizedUser,
  } = require('@whiskeysockets/baileys');
const { toDataURL } = require('qrcode');
const dirName = require('../dirname.js');
const response = require('../response.js');
const { deleteFileIfExists } = require('../functions/function.js');
const fs = require('fs');
const path = require('path');
const { query } = require('../database/dbpromise.js');

const sessions = new Map();
const retries = new Map();

const sessionsDir = (sessionId = '') => join(dirName, 'sessions', sessionId ? `${sessionId}.json` : '');

const isSessionExists = (sessionId) => sessions.has(sessionId);
const isSessionFileExists = (name) => existsSync(sessionsDir(name));

const shouldReconnect = (sessionId) => {
    let maxRetries = 5;
    let attempts = retries.get(sessionId) ?? 0;
    if (attempts < maxRetries) {
        retries.set(sessionId, attempts + 1);
        console.log('Reconnecting...', { attempts: attempts + 1, sessionId });
        return true;
    }
    return false;
};


const createMemoryStore = () => {
    const store = {
        messages: {},
        chats: {},
        loadMessage: async (jid, id) => {
            let msg = store.messages[`${jid}|${id}`];
            if (!msg) {
                for (const k in store.messages) {
                    if (k.endsWith(id)) {
                        msg = store.messages[k];
                        break;
                    }
                }
            }
            return msg;
        },
        insertMessage: (msg) => { 
            const key = `${msg.key.remoteJid}|${msg.key.id}`;
            const existing = store.messages[key];
            
            // BLINDAJE: Evita que los ecos de WhatsApp borren la llave secreta
            if (existing && existing.message?.messageContextInfo?.messageSecret && msg.message) {
                if (!msg.message.messageContextInfo) msg.message.messageContextInfo = {};
                if (!msg.message.messageContextInfo.messageSecret) {
                    msg.message.messageContextInfo.messageSecret = existing.message.messageContextInfo.messageSecret;
                }
            }
            store.messages[key] = msg; 
        },
        bind: (ev) => {
            ev.on('messages.upsert', (m) => {
                m.messages.forEach(msg => store.insertMessage(msg));
            });
        }
    };
    return store;
};

// ==========================================
// FIX: Búsqueda Inteligente de Sesiones
// ==========================================
const getSession = (sessionId) => {
    // 1. Intentamos buscar por coincidencia exacta (Base64)
    if (sessions.has(sessionId)) return sessions.get(sessionId);
    
    // 2. Si no lo encuentra, traducimos las llaves de la memoria RAM
    for (const [key, session] of sessions.entries()) {
        try {
            const decoded = JSON.parse(Buffer.from(key, 'base64').toString('utf-8'));
            const uniqueId = `${decoded.uid}_${decoded.client_id}`;
            // Si el nombre de la BD coincide con la llave decodificada, ¡lo encontramos!
            if (uniqueId === sessionId || decoded.client_id === sessionId) {
                return session;
            }
        } catch (e) {
            // Ignorar archivos que no sean JSON en Base64 válidos
        }
    }
    return null;
};

const createSession = async (sessionId, isLegacy = false, req, res, getPairCode, syncMax = false) => {
    const sessionFile = 'md_' + sessionId;
    const logger = pino({ level: 'silent' });

    const store = createMemoryStore();

    const { state, saveCreds } = await useMultiFileAuthState(sessionsDir(sessionFile));

    const waConfig = {
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: [process.env.APP_NAME || 'Chrome', '', ''],
        defaultQueryTimeoutMs: 0,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }
            return message;
        },
        syncFullHistory: syncMax || false,
        getMessage: async (key) => {
            if (store) {
                let msg = await store.loadMessage(key?.remoteJid, key?.id);
                if (!msg) {
                    // Búsqueda profunda si el JID no coincide exactamente
                    for (const k in store.messages) {
                        if (k.endsWith(key?.id)) {
                            msg = store.messages[k];
                            break;
                        }
                    }
                }
                return msg?.message || undefined;
            }
            return undefined; // Debe devolver undefined para que Baileys sepa que falló
        }
    };

    const wa = makeWASocket(waConfig);

    store.bind(wa.ev);

    const originalSendMessage = wa.sendMessage;
    wa.sendMessage = async (...args) => {
        const sentMsg = await originalSendMessage.apply(wa, args);
        if (sentMsg && sentMsg.key) {
            store.insertMessage(sentMsg);
        }
        return sentMsg;
    };

    sessions.set(sessionId, { ...wa, store, isLegacy });
    wa.ev.on('creds.update', saveCreds);

    wa.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (connection === 'open') {
            retries.delete(sessionId);
            try {
                const decodedSession = JSON.parse(Buffer.from(sessionId, 'base64').toString('utf-8'));
                const userUid = decodedSession.uid;          
                const instanceTitle = decodedSession.client_id; 
                const uniqueId = `${userUid}_${instanceTitle}`;
                const userData = wa.user; 
                
                let phoneNumber = '';
                if (userData && userData.id) {
                    phoneNumber = userData.id.split(':')[0].split('@')[0];
                }
                
                const dataJson = JSON.stringify(userData);

                await query(
                    `UPDATE instance SET status = 'CONNECTED', number = ?, data = ?, qr = '', uniqueId = ? WHERE uid = ? AND title = ?`, 
                    [phoneNumber, dataJson, uniqueId, userUid, instanceTitle]
                );
            } catch (dbError) {
                console.error('Error al guardar la conexión en BD:', dbError);
            }
        }

        if (connection === 'close') {
            if (statusCode === DisconnectReason.loggedOut || !shouldReconnect(sessionId)) {
                if (res && !res.headersSent) {
                    response(res, 500, false, 'Unable to create session.');
                }
                return deleteSession(sessionId, isLegacy);
            }
            setTimeout(() => createSession(sessionId, isLegacy, req, res, getPairCode), 
                statusCode === DisconnectReason.restartRequired ? 0 : 5000
            );
        }

        if (qr && res && !res.headersSent) {
            try {
                const qrData = await toDataURL(qr);
                const decodedSession = JSON.parse(Buffer.from(sessionId, 'base64').toString('utf-8'));
                const userUid = decodedSession.uid;
                const instanceTitle = decodedSession.client_id;
                
                await query(`UPDATE instance SET qr = ? WHERE uid = ? AND title = ?`, [qrData, userUid, instanceTitle]);
                
                res.json({ success: true, msg: 'QR code received', qr: qrData, sessionId });
                res.end();
            } catch {
                response(res, 500, false, 'Unable to create QR code.');
            }
        }
    });

    wa.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        const session = getSession(sessionId);

        if (message?.key?.remoteJid !== 'status@broadcast' && m.type === 'notify') {
            const { chatbotInit } = require('../loops/chatBot.js');
            const { webhookIncoming } = require('../functions/x.js');

            if (!message.key.fromMe) {
                if (message?.message?.pollUpdateMessage) {
                    console.log("📥 Voto recibido. Delegando al motor actualizado de Baileys...");
                } else {
                    chatbotInit(m, wa, sessionId, session);
                }
            }
            webhookIncoming(message, sessionId, session);
        }
    });

    wa.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update?.pollUpdates && update.update.pollUpdates.length > 0) {
                const pollData = update.update.pollUpdates[0];
                if (pollData.vote) {
                    console.log("✅ ¡VOTO DESCIFRADO NATIVAMENTE!");
                    const { chatbotInit } = require('../loops/chatBot.js');
                    const session = getSession(sessionId);
                    
                    const storedMsg = await store.loadMessage(update.key.remoteJid, update.key.id);
                    if (storedMsg && storedMsg.message) {
                        const meId = jidNormalizedUser(wa.user?.id);
                        const pollMessageData = getAggregateVotesInPollMessage({
                            message: storedMsg.message,
                            pollUpdates: update.update.pollUpdates
                        }, meId);

                        const m = {
                            messages: [{
                                key: pollData.pollUpdateMessageKey,
                                remoteJid: update.key.remoteJid,
                                pushName: "Usuario",
                                messageTimestamp: Math.floor(Date.now() / 1000),
                                message: { pollUpdateMessage: {} }
                            }],
                            type: 'notify'
                        };
                        chatbotInit(m, wa, sessionId, session, pollMessageData);
                    }
                }
            }
        }
    });
};

const deleteDirectory = (directoryPath) => {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const filePath = `${directoryPath}/${file}`;
            if (fs.lstatSync(filePath).isDirectory()) deleteDirectory(filePath);
            else fs.unlinkSync(filePath);
        });
        fs.rmdirSync(directoryPath);
    }
};

const deleteSession = async (sessionId, isLegacy = false) => {
    const sessionFile = 'md_' + sessionId;
    const storeFile = `${sessionId}_store`;
    deleteFileIfExists(`${process.cwd()}/contacts/${sessionId}.json`);

    if (isSessionFileExists(sessionFile)) deleteDirectory(sessionsDir(sessionFile));
    if (isSessionFileExists(storeFile)) unlinkSync(sessionsDir(storeFile));

    sessions.delete(sessionId);
    retries.delete(sessionId);
};

const cleanup = () => {
    console.log('Running cleanup before exit.');
    sessions.forEach((session, sessionId) => {});
};

const init = () => {
    const sDir = path.join(dirName, 'sessions');
    if (!fs.existsSync(sDir)) {
        fs.mkdirSync(sDir, { recursive: true });
    }
    fs.readdir(sDir, (err, files) => {
        if (err) throw err;
        for (const file of files) {
            // Ignoramos archivos basura
            if (!file.endsWith('.json') || !file.startsWith('md_') || file.includes('_store')) continue;
            const filename = file.replace('.json', '');
            const isLegacy = filename.split('_', 1)[0] !== 'md';
            const sessionId = filename.substring(isLegacy ? 7 : 3);
            createSession(sessionId, isLegacy);
        }
    });
};

module.exports = {
    isSessionExists,
    createSession,
    getSession,
    deleteSession,
    cleanup,
    init,
    downloadMediaMessage,
    getUrlInfo
};
