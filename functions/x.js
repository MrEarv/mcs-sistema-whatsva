const { downloadMediaMessage, delay, generateMessageIDV2, generateMessageID } = require('@whiskeysockets/baileys');
const fs = require('fs')
const mime = require('mime-types');
const randomstring = require('randomstring')
const { query } = require('../database/dbpromise');
const path = require('path');
const { getIOInstance } = require('../socket');
const { getSession } = require('../middlewares/req');
const { fetchProfileUrl, fetchGroupMeta } = require('./control');
const { decodeObject, updateMessageObjectInFile, addObjectToFile, encodeChatId, removeNumberAfterColon, saveImageToFile } = require('./function');

if (!global.processedMsgIds) {
    global.processedMsgIds = new Set();
}

// Tiempo máximo (ms) esperando el ack del servidor de WhatsApp tras enviar
const ACK_WAIT_MS = Number(process.env.WA_ACK_WAIT_MS) || 6000;

function downloadMediaPromise(m, mimetype) {
    return new Promise(async (resolve) => {
        try {
            const bufferMsg = await downloadMediaMessage(m, 'buffer', {}, {})
            const randomSt = randomstring.generate(6)

            const cleanMime = mimetype ? mimetype.split(';')[0] : '';
            let ext = mime.extension(cleanMime);

            if (!ext) {
                if (cleanMime.includes('audio')) ext = 'ogg';
                else if (cleanMime.includes('video')) ext = 'mp4';
                else if (cleanMime.includes('webp')) ext = 'webp';
                else ext = 'bin';
            }

            const fileName = `${randomSt}.${ext}`
            const filePath = `${__dirname}/../client/public/media/${fileName}`

            saveImageToFile(bufferMsg, filePath, mimetype)

            resolve({ success: true, fileName })
        } catch (err) {
            console.log(err)
            resolve({ err, success: false })
        }
    })
}
async function convertMsg({ obj = {}, outgoing = false }) {
    const timestamp = Math.floor(Date.now() / 1000);

    if (!obj?.key?.remoteJid || obj.key.remoteJid === "status@broadcast") return null;

    const isGroup = obj.key.remoteJid.endsWith("@g.us");
    const remoteJid = obj.key.remoteJid;
    const msgId = obj.key.id;
    const senderName = obj.pushName || "Usuario";
    const route = outgoing ? 'outgoing' : "incoming";

    const buildReturn = (type, msgContext, context = "") => ({
        group: isGroup, type, msgId, remoteJid, msgContext, reaction: "",
        timestamp: obj.messageTimestamp || timestamp,
        senderName, status: "sent", star: false, route, context
    });

    if (obj?.message?.imageMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.imageMessage.mimetype);
        const ctx = obj.message.imageMessage.contextInfo;
        return buildReturn("image", {
            caption: obj.message.imageMessage.caption || "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.imageMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.locationMessage) {
        const loc = obj.message.locationMessage;
        return buildReturn("loc", {
            lat: loc.degreesLatitude,
            long: loc.degreesLongitude,
            name: loc.name || "",
            address: loc.address || ""
        });
    }
    else if (obj?.message?.conversation || obj?.message?.extendedTextMessage?.text) {
        const text = obj.message.conversation || obj.message.extendedTextMessage.text;
        const ctx = obj.message.extendedTextMessage?.contextInfo;
        return buildReturn("text", { text }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.videoMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.videoMessage.mimetype);
        const ctx = obj.message.videoMessage.contextInfo;
        return buildReturn("video", {
            caption: obj.message.videoMessage.caption || "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.videoMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.documentMessage) {
        const docMsg = obj.message.documentMessage;
        const downloadMedia = await downloadMediaPromise(obj, docMsg.mimetype?.replace("application/x-javascript", "application/javascript"));
        const ctx = docMsg.contextInfo;
        return buildReturn("doc", {
            caption: docMsg.caption || "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: docMsg.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.audioMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.audioMessage.mimetype);
        const ctx = obj.message.audioMessage.contextInfo;
        return buildReturn("aud", {
            caption: "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.audioMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.documentWithCaptionMessage) {
        const docMsg = obj.message.documentWithCaptionMessage.message.documentMessage;
        const downloadMedia = await downloadMediaPromise(obj, docMsg.mimetype?.replace("application/x-javascript", "application/javascript"));
        const ctx = obj.message.documentWithCaptionMessage.contextInfo;
        return buildReturn("doc_cap", {
            caption: docMsg.caption || "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: docMsg.mimetype?.replace("application/x-javascript", "application/javascript")
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.stickerMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.stickerMessage.mimetype);
        const ctx = obj.message.stickerMessage.contextInfo;
        return buildReturn("sticker", {
            caption: "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.stickerMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.contactMessage) {
        const ctx = obj.message.contactMessage.contextInfo;
        return buildReturn("contact", {
            displayName: obj.message.contactMessage.displayName,
            vcard: obj.message.contactMessage.vcard
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    else if (obj?.message?.update && obj?.update?.status) {
        return {
            group: isGroup, type: "update",
            updateType: obj.update.status === 4 ? "read" : "delivery",
            msgId: obj.key.id
        };
    }
    else if (obj?.message?.reactionMessage) {
        return {
            group: isGroup, type: "reaction",
            msgId: obj.message.reactionMessage.key.id,
            reaction: obj.message.reactionMessage.text
        };
    }

    return null;
}

function lidMapPath(uid) {
    return path.join(__dirname, `../conversations/${uid}_lids.json`);
}

function readLidMap(uid) {
    try {
        const mapPath = lidMapPath(uid);
        if (fs.existsSync(mapPath)) {
            return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error leyendo mapa LID:', e.message);
    }
    return {};
}

function getRealJidFromLid(uid, lid) {
    const map = readLidMap(uid);
    return map[lid] || null;
}

function saveLidMapping(uid, lid, realJid) {
    try {
        const mapPath = lidMapPath(uid);
        fs.mkdirSync(path.dirname(mapPath), { recursive: true });
        const map = readLidMap(uid);
        map[lid] = realJid;
        fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));
    } catch (e) {
        console.error('Error guardando mapa LID:', e.message);
    }
}

async function extractData(m, sessionId) {
    const { uid } = decodeObject(sessionId);

    let rawRemoteJid = m?.key?.remoteJid || "";
    let remoteJid = removeNumberAfterColon(rawRemoteJid);

    const altJid = m?.key?.remoteJidAlt;
    if (remoteJid?.includes('@lid') && altJid && altJid.endsWith('@s.whatsapp.net')) {
        saveLidMapping(uid, remoteJid, removeNumberAfterColon(altJid));
    }

    const actualObj = await convertMsg({
        obj: m,
        outgoing: m?.key?.fromMe ? true : false
    });

    if (actualObj) {
        actualObj.remoteJid = remoteJid;
    }

    if (remoteJid?.includes('@lid')) {
        let realJid = getRealJidFromLid(uid, remoteJid);

        if (!realJid && actualObj?.context?.id) {
            const log = await query(`SELECT send_to FROM broadcast_log WHERE msg_id = ?`, [actualObj.context.id]);
            if (log.length > 0) {
                realJid = `${String(log[0].send_to).replace(/\D/g, '')}@s.whatsapp.net`;
                saveLidMapping(uid, remoteJid, realJid);
            }
        }

        if (!realJid && actualObj?.senderName) {
            const possibleChats = await query(`
                SELECT sender_jid FROM chats
                WHERE uid = ? AND instance_id = ? AND sender_name = ? AND sender_jid NOT LIKE '%@lid%'
            `, [uid, sessionId, actualObj.senderName]);

            if (possibleChats.length === 1) {
                realJid = possibleChats[0].sender_jid;
                saveLidMapping(uid, remoteJid, realJid);
            }
        }

        if (realJid) {
            remoteJid = realJid;
            if (actualObj) actualObj.remoteJid = realJid;
        }
    }

    let isGroup = remoteJid?.endsWith("@g.us");
    let num = isGroup ? remoteJid.replace("@g.us", "") : remoteJid.replace("@s.whatsapp.net", "").replace("@lid", "");
    let chatId = null;

    if (!isGroup && num.length >= 10) {
        const last10 = num.slice(-10);
        const allChats = await query(`SELECT chat_id, sender_jid, sender_mobile FROM chats WHERE uid = ? AND instance_id = ?`, [uid, sessionId]);
        for (const c of allChats) {
            if ((c.sender_jid && String(c.sender_jid).includes(last10)) ||
                (c.sender_mobile && String(c.sender_mobile).includes(last10))) {
                chatId = c.chat_id;
                break;
            }
        }
    }

    if (!chatId) {
        chatId = uid ? encodeChatId({ ins: sessionId, grp: isGroup, num: num }) : { na: "na" };
    }

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

    return {
        uid: uid,
        sessionId,
        chatId,
        actualObj,
        userData: getUser[0],
        msgFromMe: m?.key?.fromMe,
        remoteJid: remoteJid
    };
}

async function returnStateDelivery(obj, uid, sessionId) {
    let remoteJid = obj?.key?.remoteJid || "";
    remoteJid = removeNumberAfterColon(remoteJid);

    if (remoteJid.includes('@lid')) {
        let realJid = getRealJidFromLid(uid, remoteJid);
        if (realJid) remoteJid = realJid;
    }

    let isGroup = remoteJid.endsWith("@g.us");
    let num = isGroup ? remoteJid.replace("@g.us", "") : remoteJid.replace("@s.whatsapp.net", "").replace("@lid", "");
    let chatId = null;

    if (!isGroup && num.length >= 10) {
        const last10 = num.slice(-10);
        const allChats = await query(`SELECT chat_id, sender_jid, sender_mobile FROM chats WHERE uid = ? AND instance_id = ?`, [uid, sessionId]);
        for (const c of allChats) {
            if ((c.sender_jid && String(c.sender_jid).includes(last10)) ||
                (c.sender_mobile && String(c.sender_mobile).includes(last10))) {
                chatId = c.chat_id;
                break;
            }
        }
    }

    if (!chatId) {
        chatId = encodeChatId({ ins: sessionId, grp: isGroup, num: num });
    }

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

    return {
        chatId: chatId,
        userData: getUser[0]
    };
}

async function updateReaction({ uid, chatId, reaction, msgId, actualObj }) {
    const io = getIOInstance()
    const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid])
    const socketId = getId[0]?.socket_id

    const filePath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`

    io.to(socketId).emit('push_new_reaction', {
        reaction: reaction,
        chatId: chatId,
        msgId: msgId
    })

    setTimeout(() => {
        updateMessageObjectInFile(
            filePath,
            actualObj?.msgId,
            "reaction",
            actualObj?.reaction
        )
    }, 1000);
}

async function updatingInMysql({ session, remoteJid, isGroup, chatId, actualObj, uid, sessionId, chat, fromMe }) {
    try {
        if (!fromMe && chat.length < 1) {
            let profile_image = "";
            try {
                const image = await fetchProfileUrl(session, remoteJid)
                if (image) profile_image = image;
            } catch (e) { }

            let groupData = "";
            let notRestrict = 1;

            if (isGroup) {
                try {
                    groupData = await fetchGroupMeta(session, remoteJid)
                    if (groupData?.restrict) notRestrict = 0;
                } catch (e) { }
            }

            await query(
                `INSERT INTO chats (
                    chat_id, uid, last_message_came, sender_name, sender_mobile, sender_jid, last_message, instance_id, profile, other
                ) VALUES (?,?,?,?,?,?,?,?,?,?)`, [
                chatId || null,
                uid || null,
                actualObj?.timestamp || null,
                (actualObj?.group ? groupData?.subject : actualObj?.senderName) || "Usuario",
                remoteJid?.replace(/@s\.whatsapp\.net|@g\.us/g, "") || null,
                remoteJid || null,
                JSON.stringify(actualObj) || null,
                sessionId || null,
                profile_image || null,
                groupData ? JSON.stringify(groupData) : null
            ]);
        } else {
            await query(`UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND uid = ? AND instance_id = ? `, [
                actualObj?.timestamp || null,
                JSON.stringify(actualObj) || null,
                0,
                chatId || null,
                uid || null,
                sessionId || null
            ]);
        }
    } catch (err) {
        throw err;
    }
}

// JID "canónico" del chat: el que está guardado en la tabla chats (sender_jid).
// El frontend identifica cada chat por ese JID, así que todo evento en vivo
// (push_new_msg) debe llevarlo en msg.remoteJid, sin importar si Meta lo mandó
// como 52... o 521... o si el bot respondió con otra variante.
async function getChatJid(uid, sessionId, chatId, fallback) {
    try {
        if (!chatId || typeof chatId !== 'string') return fallback;
        const rows = await query(
            `SELECT sender_jid FROM chats WHERE chat_id = ? AND uid = ? AND instance_id = ? LIMIT 1`,
            [chatId, uid, sessionId]
        );
        return rows?.[0]?.sender_jid || fallback;
    } catch (e) {
        return fallback;
    }
}

async function sendNewMsgSocket({
    uid,
    sessionId,
    chatId,
    actualObj
}) {
    const io = getIOInstance()

    const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid])

    const chats = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ?`, [uid, sessionId])

    const chatJid = await getChatJid(uid, sessionId, chatId, actualObj?.remoteJid);
    const msgForUi = { ...actualObj, remoteJid: chatJid };

    io.to(getId[0]?.socket_id).emit('update_conversations', { chats: chats });

    io.to(getId[0]?.socket_id).emit('push_new_msg', { msg: msgForUi, chatId: chatId, sessionId: sessionId })
}

async function webhookIncoming(m, sessionId, session) {
    try {
        const state = await extractData(m, sessionId);

        if (!state.uid || !state.actualObj) {
            return;
        }
        if (global.processedMsgIds && global.processedMsgIds.has(state.actualObj.msgId)) {
            return;
        }

        if (state.actualObj.type === "reaction") {
            await updateReaction({ uid: state.uid, chatId: state.chatId, reaction: state.actualObj.reaction, msgId: state.actualObj.msgId, actualObj: state.actualObj });
            return;
        }
        if (state.actualObj.type === "update") {
            return;
        }

        const chat = await query(`SELECT * FROM chats WHERE chat_id = ? AND uid = ? AND instance_id = ?`, [
            state.chatId || null,
            state.uid || null,
            state.sessionId || null
        ]);

        await updatingInMysql({
            session: session, remoteJid: state.remoteJid, isGroup: state.actualObj.group, chatId: state.chatId, actualObj: state.actualObj, uid: state.uid, sessionId: state.sessionId, chat: chat, fromMe: state.msgFromMe
        });

        const chatPath = `${__dirname}/../conversations/inbox/${state.uid}/${state.chatId}.json`;
        addObjectToFile(state.actualObj, chatPath);

        if (state.userData?.opened_chat_instance && state.userData?.opened_chat_instance === state.sessionId) {
            await sendNewMsgSocket({
                uid: state.uid, sessionId: state.sessionId, actualObj: state.actualObj, chatId: state.chatId
            });
        }
    } catch (e) {
        console.error("CRASH EN WEBHOOK:", e);
    }
}

async function updateDeliverySocket({ uid, chatId, obj }) {
    const io = getIOInstance();
    const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);
    const socketId = getId[0]?.socket_id;

    if (socketId) {
        io.to(socketId).emit('update_delivery_status', {
            chatId: chatId,
            status: obj?.update?.status === 4 ? "read" : "delivered",
            msgId: obj?.key?.id,
        });
    }
}

function extractVoters(options) {
    if (!Array.isArray(options)) {
        return [];
    }

    let result = [];

    for (let option of options) {
        if (typeof option !== 'object' || !option.hasOwnProperty('name') || !Array.isArray(option.voters)) {
            return [];
        }

        option.voters.forEach(voter => {
            if (typeof voter === 'string') {
                result.push({ name: option.name, voter: voter });
            }
        });
    }

    return result;
}

async function updatePool(vote, uid, msg_id, jid) {
    const voter = extractVoters(vote)

    if (voter.length < 1) {
        await query(`DELETE FROM poll_votes WHERE uid = ? AND msg_id = ? AND voter = ?`, [
            uid,
            msg_id,
            jid
        ])
    } else {

        const voterJid = voter[0]?.voter
        const option = voter[0]?.name

        if (voterJid && option) {
            await query(`INSERT INTO poll_votes (uid, msg_id, vote_option, voter) VALUES (?,?,?,?)`, [
                uid,
                msg_id,
                option,
                voterJid
            ])
        }

    }
}

async function updateDelivery(obj, sessionId, pollMessage) {
    await delay(2000)
    if (pollMessage && pollMessage?.length > 0) {
        const { uid } = decodeObject(sessionId)
        await updatePool(pollMessage, uid, obj?.key?.id, obj?.update?.pollUpdates?.[0]?.pollUpdateMessageKey?.participant)
    }

    if (obj?.key?.fromMe) {
        const { uid } = decodeObject(sessionId)

        // Atrapa el LID usando el log de campañas
        let rawRemoteJid = obj?.key?.remoteJid || "";
        if (rawRemoteJid.includes('@lid')) {
            try {
                const msgId = obj?.key?.id;
                const log = await query(`SELECT send_to FROM broadcast_log WHERE msg_id = ?`, [msgId]);
                if (log.length > 0) {
                    const realJid = `${String(log[0].send_to).replace(/\D/g, '')}@s.whatsapp.net`;
                    saveLidMapping(uid, rawRemoteJid, realJid);
                }
            } catch (e) {
                console.error("Error atrapando LID en updateDelivery:", e);
            }
        }

        const state = await returnStateDelivery(obj, uid, sessionId)

        if (state.userData?.opened_chat_instance === sessionId) {
            await updateDeliverySocket({
                uid: uid,
                chatId: state.chatId,
                obj: obj,
                sessionId: sessionId
            })
        }

        const delivery_time = Date.now() / 1000
        await query(`UPDATE broadcast_log SET delivery_status = ?, delivery_time = ? WHERE msg_id = ?`, [
            obj?.update?.status >= 4 ? "read" : "delivered",
            delivery_time,
            obj?.key?.id
        ])

        const filePath = `${__dirname}/../conversations/inbox/${uid}/${state.chatId}.json`

        setTimeout(() => {
            updateMessageObjectInFile(
                filePath,
                obj?.key?.id,
                "status",
                obj?.update?.status >= 4 ? "read" : "delivered"
            )
        }, 1000);
    }
}

// ==========================================================
// ENVÍO: helpers para verificar que Meta realmente aceptó el mensaje
// ==========================================================

// Pregunta a WhatsApp cuál es el JID real del número (resuelve 52 vs 521 sin adivinar).
// Devuelve: string (jid válido) | null (el número NO existe en WhatsApp).
// Si la consulta falla por red/timeout, devuelve el JID original para no bloquear el envío.
async function resolveJid(session, jid) {
    try {
        if (!jid) return null;
        // Grupos y LID se envían tal cual
        if (jid.endsWith('@g.us') || jid.endsWith('@lid')) return jid;

        const cleanJid = removeNumberAfterColon(jid);
        const digits = cleanJid.replace(/@.*$/, '').replace(/\D/g, '');
        if (!digits) return null;

        // México: WhatsApp puede conocer el número como 52+10 dígitos o 521+10 dígitos
        let candidates = [digits];
        if (digits.startsWith('52') && (digits.length === 12 || digits.length === 13)) {
            const last10 = digits.slice(-10);
            candidates = [`52${last10}`, `521${last10}`];
        }

        const results = await session.onWhatsApp(...candidates);
        const hit = Array.isArray(results) ? results.find(r => r?.exists) : null;

        if (hit?.jid) return hit.jid;
        if (Array.isArray(results) && results.length > 0) return null; // respondió y ninguno existe
        return cleanJid; // respuesta vacía: no se puede concluir, se usa el original
    } catch (e) {
        console.warn('[resolveJid] onWhatsApp falló, se usa el JID original:', e?.message);
        return removeNumberAfterColon(jid);
    }
}

// Espera el ack del servidor (lo llena req.js en session.acks).
// Devuelve { status, params } o null si no llegó a tiempo.
async function waitForAck(session, msgId, ms = ACK_WAIT_MS) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const a = session?.acks?.get(msgId);
        if (a && (a.status === 0 || a.status >= 2)) return a;
        await new Promise(r => setTimeout(r, 300));
    }
    return null;
}

function newMessageId(session) {
    try {
        const gen = generateMessageIDV2 || generateMessageID;
        return gen(session?.user?.id);
    } catch (e) {
        return undefined;
    }
}

// Función común de envío para texto / media / poll.
async function deliver({ uid, toJid, content, saveObj, chatId, session, sessionId }) {
    if (!session) {
        return { success: false, msg: "Instance not found. Please try again" };
    }

    if (session?.ws && session.ws.isOpen === false) {
        return { success: false, msg: "La sesión de WhatsApp no está conectada. Reconecta la instancia." };
    }

    const realJid = await resolveJid(session, toJid);
    if (!realJid) {
        return { success: false, msg: "El número no existe en WhatsApp (verifica el código de país y el número)." };
    }
    if (realJid !== toJid) {
        console.log(`[deliver] JID resuelto: ${toJid} -> ${realJid}`);
    }

    const messageId = newMessageId(session);
    if (messageId) {
        global.processedMsgIds.add(messageId);
        setTimeout(() => global.processedMsgIds.delete(messageId), 120000);
    }

    const msg = await session.sendMessage(realJid, content, messageId ? { messageId } : undefined);

    if (!msg?.key?.id) {
        return { success: false, msg: "Error desconocido de Meta al enviar." };
    }

    const msgId = msg.key.id;
    global.processedMsgIds.add(msgId);
    setTimeout(() => global.processedMsgIds.delete(msgId), 120000);

    const ack = await waitForAck(session, msgId);

    if (ack && ack.status === 0) {
        const code = Array.isArray(ack.params) ? ack.params.join(' | ') : String(ack.params || '');
        console.error(`[deliver] Meta RECHAZÓ el mensaje ${msgId} para ${realJid}: ${code}`);
        global.processedMsgIds.delete(msgId);
        return {
            success: false,
            msg: `WhatsApp rechazó el mensaje${code ? ` (${code})` : ''}. Si es 463, la cuenta está restringida temporalmente para escribir a contactos.`,
            code
        };
    }

    let warning = null;
    if (!ack) {
        warning = "Sin confirmación del servidor de WhatsApp (ack) dentro del tiempo esperado.";
        console.warn(`[deliver] ${warning} msgId=${msgId} to=${realJid}`);
    }

    const unixTime = Number(msg?.messageTimestamp?.low ?? msg?.messageTimestamp) || Math.floor(Date.now() / 1000);
    const finalSaveMsg = { ...saveObj, msgId, timestamp: unixTime };
    const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;

    addObjectToFile(finalSaveMsg, chatPath);

    await query(`UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND instance_id = ?`,
        [unixTime, JSON.stringify(finalSaveMsg), 1, chatId, sessionId]);

    const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

    if (user?.opened_chat_instance === sessionId) {
        const io = getIOInstance();
        const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);

        await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [1, chatId]);

        const chats = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ?`, [uid, sessionId]);

        io.to(getId[0]?.socket_id).emit('update_conversations', { chats: chats, notificationOff: true });
        const chatJid = await getChatJid(uid, sessionId, chatId, finalSaveMsg.remoteJid);
        io.to(getId[0]?.socket_id).emit('push_new_msg', { msg: { ...finalSaveMsg, remoteJid: chatJid }, chatId: chatId, sessionId: sessionId });
    }

    return warning ? { success: true, warning, msgId } : { success: true, msgId };
}

// --------------------------
// Funciones públicas de envío (misma firma que antes)
// --------------------------

function sendPollMsg({ uid, msgObj, toJid, saveObj, chatId, session, sessionId, sendObj }) {
    return new Promise(async (resolve) => {
        try {
            const result = await deliver({
                uid, toJid, content: sendObj || msgObj, saveObj, chatId, session, sessionId
            });
            resolve(result);
        } catch (err) {
            console.log('error en sendPollMsg:', err);
            resolve({ success: false, msg: err.toString(), err });
        }
    });
}

function sendTextMsg({ uid, msgObj, toJid, saveObj, chatId, session, sessionId }) {
    return new Promise(async (resolve) => {
        try {
            const result = await deliver({
                uid, toJid, content: msgObj, saveObj, chatId, session, sessionId
            });
            resolve(result);
        } catch (err) {
            console.log('error en sendTextMsg:', err);
            resolve({ success: false, msg: err.toString(), err });
        }
    });
}

function sendMedia({ uid, msgObj, toJid, saveObj, chatId, session, sessionId, sendObj }) {
    return new Promise(async (resolve) => {
        try {
            const result = await deliver({
                uid, toJid, content: sendObj || msgObj, saveObj, chatId, session, sessionId
            });
            resolve(result);
        } catch (err) {
            console.log('error en sendMedia:', err);
            resolve({ success: false, msg: err.toString(), err });
        }
    });
}

module.exports = {
    webhookIncoming,
    updateDelivery,
    sendTextMsg,
    sendMedia,
    sendPollMsg
}