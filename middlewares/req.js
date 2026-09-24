const { existsSync, unlinkSync } = require('fs');
const { join } = require('path');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    DisconnectReason,
    useMultiFileAuthState,
    downloadMediaMessage,
    getUrlInfo,
    fetchLatestBaileysVersion,
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
// Evita crear dos sockets a la vez para la misma sesión (dos sockets con las
// mismas credenciales se pisan las llaves Signal y provocan "connectionReplaced").
const creating = new Set();

const MAX_STORE_MESSAGES = 5000;
const ACK_TTL_MS = 120000;

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
        messages: new Map(),
        chats: {},
        loadMessage: async (jid, id) => {
            let msg = store.messages.get(`${jid}|${id}`);
            if (!msg && id) {
                for (const [k, v] of store.messages) {
                    if (k.endsWith(`|${id}`)) {
                        msg = v;
                        break;
                    }
                }
            }
            return msg;
        },
        insertMessage: (msg) => {
            if (!msg?.key?.id) return;
            const key = `${msg.key.remoteJid}|${msg.key.id}`;
            const existing = store.messages.get(key);

            if (existing && existing.message?.messageContextInfo?.messageSecret && msg.message) {
                if (!msg.message.messageContextInfo) msg.message.messageContextInfo = {};
                if (!msg.message.messageContextInfo.messageSecret) {
                    msg.message.messageContextInfo.messageSecret = existing.message.messageContextInfo.messageSecret;
                }
            }
            store.messages.set(key, msg);

            if (store.messages.size > MAX_STORE_MESSAGES) {
                const oldest = store.messages.keys().next().value;
                store.messages.delete(oldest);
            }
        },
        bind: (ev) => {
            ev.on('messages.upsert', (m) => {
                m.messages.forEach((msg) => store.insertMessage(msg));
            });
        },
    };
    return store;
};

// ==========================================
// Búsqueda de sesiones
// ==========================================
const getSession = (sessionId) => {
    if (sessions.has(sessionId)) return sessions.get(sessionId);

    for (const [key, session] of sessions.entries()) {
        try {
            const decoded = JSON.parse(Buffer.from(key, 'base64').toString('utf-8'));
            const uniqueId = `${decoded.uid}_${decoded.client_id}`;
            if (uniqueId === sessionId || decoded.client_id === sessionId) {
                return session;
            }
        } catch (e) {
        }
    }
    return null;
};

const createSession = async (sessionId, isLegacy = false, req, res, getPairCode, syncMax = false) => {
    // Guarda contra creación concurrente
    if (creating.has(sessionId)) {
        console.warn(`[WA] createSession ignorado: ya hay una creación en curso para ${sessionId}`);
        return;
    }
    creating.add(sessionId);

    try {
        const sessionFile = 'md_' + sessionId;

        // Nivel de log configurable: BAILEYS_LOG=debug|info|warn|error|silent (por defecto 'warn')
        const logger = pino({ level: process.env.BAILEYS_LOG || 'warn' });

        const store = createMemoryStore();

        const { state, saveCreds } = await useMultiFileAuthState(sessionsDir(sessionFile));

        let version;
        try {
            const latest = await fetchLatestBaileysVersion();
            version = latest?.version;
        } catch (e) {
            console.warn('[WA] No se pudo obtener la última versión de WA, se usa la de Baileys.', e?.message);
        }

        const old = sessions.get(sessionId);
        if (old) {
            try { old.markReplaced?.(); } catch (e) {}
            try { old.end?.(undefined); } catch (e) {}
        }

        let replaced = false;

        const waConfig = {
            auth: state,
            printQRInTerminal: false,
            logger,
            browser: [process.env.APP_NAME || 'Chrome', '', ''],
            defaultQueryTimeoutMs: 60_000,
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
                const msg = await store.loadMessage(key?.remoteJid, key?.id);
                return msg?.message || undefined;
            },
        };
        if (version) waConfig.version = version;

        const wa = makeWASocket(waConfig);

        store.bind(wa.ev);

        // Mapa de acks de envío: msgId -> { status, params }
        // status: 0 = ERROR, 1 = PENDING, 2 = SERVER_ACK, 3 = DELIVERY_ACK, 4 = READ, 5 = PLAYED
        const acks = new Map();
        wa.acks = acks;
        wa.store = store;
        wa.isLegacy = isLegacy;
        wa.markReplaced = () => { replaced = true; };

        const originalSendMessage = wa.sendMessage;
        wa.sendMessage = async (...args) => {
            const sentMsg = await originalSendMessage.apply(wa, args);
            if (sentMsg && sentMsg.key) {
                store.insertMessage(sentMsg);
            }
            return sentMsg;
        };

        sessions.set(sessionId, wa);
        wa.ev.on('creds.update', saveCreds);

        wa.ev.on('connection.update', async (update) => {
            if (replaced) return;

            const { connection, lastDisconnect, qr } = update;
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (connection === 'open') {
                retries.delete(sessionId);
                console.log(`[WA] Conexión abierta: ${wa.user?.id}`);
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
                console.warn(`[WA] Conexión cerrada (código ${statusCode}) sesión ${sessionId.slice(0, 12)}...`, lastDisconnect?.error?.message || '');

                // Sesión cerrada desde el teléfono: única razón para borrar credenciales
                if (statusCode === DisconnectReason.loggedOut) {
                    if (res && !res.headersSent) {
                        response(res, 500, false, 'Unable to create session.');
                    }
                    return deleteSession(sessionId, isLegacy);
                }

                // Otro proceso/socket está usando las mismas credenciales: NO reconectar en bucle
                if (statusCode === DisconnectReason.connectionReplaced) {
                    console.error('[WA] connectionReplaced (440): hay OTRO proceso o socket usando estas credenciales. Revisa que solo corra un servidor (app.js o server.js, no ambos).');
                    if (res && !res.headersSent) {
                        response(res, 500, false, 'Session replaced by another connection.');
                    }
                    return;
                }

                if (!shouldReconnect(sessionId)) {
                    console.error('[WA] Se agotaron los reintentos de reconexión. Las credenciales NO se borran.');
                    if (res && !res.headersSent) {
                        response(res, 500, false, 'Unable to create session.');
                    }
                    return;
                }

                setTimeout(
                    () => createSession(sessionId, isLegacy, req, res, getPairCode, syncMax),
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
            if (replaced) return;

            const message = m.messages[0];
            const session = getSession(sessionId);

            if (message?.key?.remoteJid !== 'status@broadcast' && m.type === 'notify') {
                const { chatbotInit } = require('../loops/chatBot.js');
                const { webhookIncoming } = require('../functions/x.js');

                if (!message.key.fromMe) chatbotInit(m, wa, sessionId, session);
                webhookIncoming(message, sessionId, session);
            }
        });

        // ==========================================
        // ACKS DE ENVÍO (aquí se detectan los mensajes rechazados por Meta)
        // ==========================================
        wa.ev.on('messages.update', async (updates) => {
            if (replaced) return;
            const { updateDelivery } = require('../functions/x.js');

            for (const u of updates) {
                const st = u.update?.status;
                // OJO: status 0 = ERROR. Nunca usar `if (u.update?.status)` porque descarta el 0.
                if (st === undefined || st === null) continue;
                if (!u.key?.fromMe) continue;

                const msgId = u.key.id;
                acks.set(msgId, { status: st, params: u.update?.messageStubParameters });
                setTimeout(() => acks.delete(msgId), ACK_TTL_MS);

                if (st === 0) {
                    console.error('[WA ACK ERROR] Meta rechazó el mensaje', {
                        msgId,
                        to: u.key.remoteJid,
                        params: u.update?.messageStubParameters,
                    });
                }

                // Solo 3 (entregado) y 4/5 (leído/reproducido) actualizan la UI como entregado/leído
                if (st >= 3) {
                    updateDelivery(u, sessionId, null);
                }
            }
        });
    } finally {
        creating.delete(sessionId);
    }
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

    const s = sessions.get(sessionId);
    if (s) {
        try { s.markReplaced?.(); } catch (e) {}
        try { s.end?.(undefined); } catch (e) {}
    }

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

const isExists = async (session, jid, isGroup = false) => {
    try {
        if (isGroup) {
            const groupMeta = await session.groupMetadata(jid);
            return !!groupMeta.id;
        } else {
            const [result] = await session.onWhatsApp(jid);
            return result?.exists || false;
        }
    } catch (error) {
        return false;
    }
};

module.exports = {
    isSessionExists,
    createSession,
    getSession,
    deleteSession,
    cleanup,
    init,
    downloadMediaMessage,
    getUrlInfo,
    isExists,
};