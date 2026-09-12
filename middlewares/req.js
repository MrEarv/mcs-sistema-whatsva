const { existsSync, unlinkSync, readdir } = require('fs');
const { join } = require('path');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { 
    Browsers,
    DisconnectReason,
    delay,
    useMultiFileAuthState,
    getAggregateVotesInPollMessage,
    downloadMediaMessage,
    getUrlInfo,
    proto 
} = require('@whiskeysockets/baileys');
const { toDataURL } = require('qrcode');
const dirName = require('../dirname.js');
const response = require('../response.js');
const { decodeObject, deleteFileIfExists } = require('../functions/function.js');
const fs = require('fs');
const path = require('path');
const { query } = require('../database/dbpromise.js');
const { webhookIncoming, updateDelivery } = require('../functions/x.js');
const { chatbotInit } = require('../loops/chatBot.js');

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

// --------------------
// Crear store en memoria manual
// --------------------
const createMemoryStore = () => {
    const store = {
        messages: {},
        chats: {},
        loadMessage: async (jid, id) => store.messages[`${jid}|${id}`],
        insertMessage: (msg) => { store.messages[`${msg.key.remoteJid}|${msg.key.id}`] = msg; },
        bind: (ev) => {
            ev.on('messages.upsert', (m) => {
                m.messages.forEach(msg => store.insertMessage(msg));
            });
        }
    };
    return store;
};

// --------------------
// Crear sesión
// --------------------
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
                const msg = await store.loadMessage(key?.remoteJid, key?.id);
                return msg?.message || undefined;
            }
            return proto.Message.fromObject({});
        }
    };

    const wa = makeWASocket(waConfig);

    // Vincular store al socket
    store.bind(wa.ev);

    sessions.set(sessionId, { ...wa, store, isLegacy });
    wa.ev.on('creds.update', saveCreds);

    // --------------------
    // Manejo de conexión y QR
    // --------------------
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
                
                //console.log(`¡ÉXITO! Instancia ${instanceTitle} conectada y guardada en BD.`);
            } catch (dbError) {
                //console.error('Error al guardar la conexión en BD:', dbError);
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
                
                // Parche: Desempaquetamos también aquí para guardar el QR correctamente
                const decodedSession = JSON.parse(Buffer.from(sessionId, 'base64').toString('utf-8'));
                const userUid = decodedSession.uid;
                const instanceTitle = decodedSession.client_id;
                
                // Actualizamos buscando por UID y TITLE, no por ID numérico
                await query(`UPDATE instance SET qr = ? WHERE uid = ? AND title = ?`, [qrData, userUid, instanceTitle]);
                
                res.json({ success: true, msg: 'QR code received', qr: qrData, sessionId });
                res.end();
            } catch {
                response(res, 500, false, 'Unable to create QR code.');
            }
        }
    });

    // --------------------
    // Eventos de mensajes
    // --------------------
    wa.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        const session = await getSession(sessionId);

        if (message?.key?.remoteJid !== 'status@broadcast' && m.type === 'notify') {
            if (!message.key.fromMe) chatbotInit(m, wa, sessionId, session);
            webhookIncoming(message, sessionId, session);
        }
    });
};

// --------------------
// Sesiones y utilidades
// --------------------
const getSession = (sessionId) => sessions.get(sessionId) ?? null;

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
    fs.readdir(sDir, (err, files) => {
        if (err) throw err;
        for (const file of files) {
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
