const { downloadMediaMessage, delay } = require('@whiskeysockets/baileys');
const fs = require('fs')
const mime = require('mime-types');
const randomstring = require('randomstring')
const { query } = require('../database/dbpromise');
const path = require('path');
const { getIOInstance } = require('../socket');
const { getSession } = require('../middlewares/req');
const { fetchProfileUrl, fetchGroupMeta } = require('./control');
const { decodeObject, updateMessageObjectInFile, addObjectToFile, encodeChatId, removeNumberAfterColon, saveImageToFile } = require('./function');

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

    // 1. Imagen
    if (obj?.message?.imageMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.imageMessage.mimetype);
        const ctx = obj.message.imageMessage.contextInfo;
        return buildReturn("image", {
            caption: obj.message.imageMessage.caption || "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.imageMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    // 2. Ubicación (Restaurado a su tipo "loc" nativo)
    else if (obj?.message?.locationMessage) {
        const loc = obj.message.locationMessage;
        return buildReturn("loc", {
            lat: loc.degreesLatitude,
            long: loc.degreesLongitude,
            name: loc.name || "",
            address: loc.address || ""
        });
    }
    // 3. Texto Simple y Citas
    else if (obj?.message?.conversation || obj?.message?.extendedTextMessage?.text) {
        const text = obj.message.conversation || obj.message.extendedTextMessage.text;
        const ctx = obj.message.extendedTextMessage?.contextInfo;
        return buildReturn("text", { text }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    // 4. Video
    else if (obj?.message?.videoMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.videoMessage.mimetype);
        const ctx = obj.message.videoMessage.contextInfo;
        return buildReturn("video", {
            caption: obj.message.videoMessage.caption || "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.videoMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    // 5. Documento
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
    // 6. Audio
    else if (obj?.message?.audioMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.audioMessage.mimetype);
        const ctx = obj.message.audioMessage.contextInfo;
        return buildReturn("aud", {
            caption: "",
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.audioMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    // 7. Documento con leyenda
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
    // 8. Stickers (Le asignamos su tipo propio para que React lo dibuje pequeño y transparente)
    else if (obj?.message?.stickerMessage) {
        const downloadMedia = await downloadMediaPromise(obj, obj.message.stickerMessage.mimetype);
        const ctx = obj.message.stickerMessage.contextInfo;
        return buildReturn("sticker", {
            caption: "", 
            fileName: downloadMedia?.success ? downloadMedia.fileName : "",
            mimetype: obj.message.stickerMessage.mimetype
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    // 9. Contactos (vCard)
    else if (obj?.message?.contactMessage) {
        const ctx = obj.message.contactMessage.contextInfo;
        return buildReturn("contact", {
            displayName: obj.message.contactMessage.displayName,
            vcard: obj.message.contactMessage.vcard
        }, ctx?.stanzaId ? { jid: ctx.participant, id: ctx.stanzaId } : "");
    }
    // 10. Actualización de entrega
    else if (obj?.message?.update && obj?.update?.status) {
        return {
            group: isGroup, type: "update",
            updateType: obj.update.status === 4 ? "read" : "delivery",
            msgId: obj.key.id
        };
    }
    // 11. Reacciones
    else if (obj?.message?.reactionMessage) {
        return {
            group: isGroup, type: "reaction",
            msgId: obj.message.reactionMessage.key.id,
            reaction: obj.message.reactionMessage.text
        };
    }

    return null;
}

async function extractData(m, sessionId) {
    const { uid } = decodeObject(sessionId)

    const chatId = uid ? encodeChatId({
        ins: sessionId,
        grp: m?.key?.remoteJid?.endsWith("@g.us") ? true : false,
        num: m?.key?.remoteJid?.endsWith("@g.us")
            ? m?.key?.remoteJid?.replace("@g.us", "")
            : m?.key?.remoteJid?.replace("@s.whatsapp.net", "")
    }) : { na: "na" }

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
        uid
    ])

    const actualObj = await convertMsg({
        obj: m,
        outgoing: m?.key?.fromMe ? true : false
    })


    return {
        uid: uid,
        sessionId,
        chatId,
        actualObj,
        userData: getUser[0],
        msgFromMe: m?.key?.fromMe,
        remoteJid: m?.key?.remoteJid
    }
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
            } catch(e){}

            let groupData = "";
            let notRestrict = 1;

            if (isGroup) {
                try {
                    groupData = await fetchGroupMeta(session, remoteJid)
                    if (groupData?.restrict) notRestrict = 0;
                } catch(e){}
            }

            // Blindamos las variables con || null para evitar el crash silencioso
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
        //console.error(`ERROR CRITICO EN updatingInMysql:`, err);
        throw err; // Lanzamos el error hacia arriba para verlo en la consola
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

    io.to(getId[0]?.socket_id).emit('update_conversations', { chats: chats });

    io.to(getId[0]?.socket_id).emit('push_new_msg', { msg: actualObj, chatId: chatId, sessionId: sessionId })
}

async function webhookIncoming(m, sessionId, session) {
    try {
        const state = await extractData(m, sessionId);

        if (!state.uid || !state.actualObj) {
            return;
        }

        // 🔥 HACK: Evitamos que las reacciones y los ticks azules creen burbujas en blanco
        if (state.actualObj.type === "reaction") {
            await updateReaction({ uid: state.uid, chatId: state.chatId, reaction: state.actualObj.reaction, msgId: state.actualObj.msgId, actualObj: state.actualObj });
            return; // Cortamos el proceso aquí para no guardar un mensaje nuevo
        }
        if (state.actualObj.type === "update") {
            return; // Cortamos el proceso aquí también
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

async function returnStateDelivery(obj, uid, sessionId) {
    const chatId = encodeChatId({
        ins: sessionId,
        grp: obj?.key?.remoteJid?.endsWith("@g.us") ? true : false,
        num: obj?.key?.remoteJid?.endsWith("@s.whatsapp.net") ?
            removeNumberAfterColon(obj?.key?.remoteJid)?.replace("@s.whatsapp.net", "") :
            removeNumberAfterColon(obj?.key?.remoteJid)?.replace("@g.us", "")
    })

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
        uid
    ])

    return {
        chatId: chatId,
        userData: getUser[0]
    }
}

async function updateDeliverySocket({ uid, chatId, obj }) {
    const io = getIOInstance()
    const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid])
    const socketId = getId[0]?.socket_id

    io.to(socketId).emit('update_delivery_status', {
        chatId: chatId,
        status: obj?.update?.status === 4 ? "read" : "delivered",
        msgId: obj?.key?.id,
    })
}

function extractVoters(options) {
    // Check if options is a valid array
    if (!Array.isArray(options)) {
        return [];
    }

    let result = [];

    for (let option of options) {
        // Check if each option is a valid object with the required properties
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
        await updatePool(pollMessage, uid, obj?.key?.id, obj?.update?.pollUpdates[0]?.pollUpdateMessageKey?.participant)
    }


    if (obj?.key?.fromMe) {
        const { uid } = decodeObject(sessionId)
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
            obj?.update?.status === 4 ? "read" : "delivered",
            delivery_time,
            obj?.key?.id
        ])

        // adding delivery update locally 
        const filePath = `${__dirname}/../conversations/inbox/${uid}/${state.chatId}.json`

        setTimeout(() => {
            updateMessageObjectInFile(
                filePath,
                obj?.key?.id,
                "status",
                obj?.update?.status === 4 ? "read" : "delivered"
            )
        }, 1000);
    }
}

// --------------------------  

function sendPollMsg({ uid, msgObj, toJid, saveObj, chatId, session, sessionId, sendObj }) {
    return new Promise(async (resolve) => {
        try {

            if (!session) {
                return res.json({
                    success: false,
                    msg: "Instance not found. Please try again"
                })
            }

            const msg = await session.sendMessage(toJid, sendObj)

            if (msg?.key?.id) {

                const finalSaveMsg = { ...saveObj, msgId: msg?.key?.id, timestamp: msg?.messageTimestamp?.low, }

                const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`

                addObjectToFile(finalSaveMsg, chatPath)

                await query(`UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND instance_id = ?`,
                    [
                        msg?.messageTimestamp?.low,
                        JSON.stringify(finalSaveMsg),
                        1,
                        chatId,
                        sessionId
                    ])

                // updating socket 
                const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [
                    uid
                ])

                if (user?.opened_chat_instance === sessionId) {
                    const io = getIOInstance();

                    const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid])

                    await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [1, chatId])

                    const chats = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ?`, [uid, sessionId])

                    io.to(getId[0]?.socket_id).emit('update_conversations', { chats: chats, notificationOff: true });

                    io.to(getId[0]?.socket_id).emit('push_new_msg', { msg: finalSaveMsg, chatId: chatId, sessionId: sessionId })
                }

                resolve({ success: true })

            } else {
                console.log(`error found in sendPollMsg`, msg)
                resolve({
                    msg: "Unknown error found could not send messsage. Please try to re add instance",
                    err: msg?.toString()
                })
            }

        } catch (err) {
            resolve({ success: false, msg: err.toString(), err })
            console.log(err)
        }
    })
}

function sendTextMsg({ uid, msgObj, toJid, saveObj, chatId, session, sessionId }) {
    return new Promise(async (resolve) => {
        try {

            if (!session) {
                return res.json({
                    success: false,
                    msg: "Instance not found. Please try again"
                })
            }
            const msg = await session.sendMessage(toJid, msgObj)

            if (msg?.key?.id) {

                const finalSaveMsg = { ...saveObj, msgId: msg?.key?.id, timestamp: msg?.messageTimestamp?.low, }

                const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`

                addObjectToFile(finalSaveMsg, chatPath)

                await query(`UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND instance_id = ?`,
                    [
                        msg?.messageTimestamp?.low,
                        JSON.stringify(finalSaveMsg),
                        1,
                        chatId,
                        sessionId
                    ])

                // updating socket 
                const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [
                    uid
                ])

                if (user?.opened_chat_instance === sessionId) {
                    const io = getIOInstance();

                    const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid])

                    await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [1, chatId])

                    const chats = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ?`, [uid, sessionId])

                    io.to(getId[0]?.socket_id).emit('update_conversations', { chats: chats, notificationOff: true });

                    io.to(getId[0]?.socket_id).emit('push_new_msg', { msg: finalSaveMsg, chatId: chatId, sessionId: sessionId })
                }

                resolve({ success: true })

            } else {
                console.log(`error found in sendChatTextMessage`, msg)
                resolve({
                    msg: "Unknown error found could not send messsage. Please try to re add instance",
                    err: msg?.toString()
                })
            }

        } catch (err) {
            resolve({ success: false, msg: err.toString(), err })
            console.log(err)
        }
    })
}


function sendMedia({ uid, msgObj, toJid, saveObj, chatId, session, sessionId, sendObj }) {
    return new Promise(async (resolve) => {
        try {
            if (!session) {
                return res.json({
                    success: false,
                    msg: "Instance not found. Please try again"
                })
            }

            const msg = await session.sendMessage(toJid, sendObj)

            if (msg?.key?.id) {

                const finalSaveMsg = { ...saveObj, msgId: msg?.key?.id, timestamp: msg?.messageTimestamp?.low, }

                const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`

                addObjectToFile(finalSaveMsg, chatPath)

                await query(`UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND instance_id = ?`,
                    [
                        msg?.messageTimestamp?.low,
                        JSON.stringify(finalSaveMsg),
                        1,
                        chatId,
                        sessionId
                    ])

                // updating socket 
                const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [
                    uid
                ])

                if (user?.opened_chat_instance === sessionId) {
                    const io = getIOInstance();

                    const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid])

                    await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [1, chatId])

                    const chats = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ?`, [uid, sessionId])

                    io.to(getId[0]?.socket_id).emit('update_conversations', { chats: chats, notificationOff: true });

                    io.to(getId[0]?.socket_id).emit('push_new_msg', { msg: finalSaveMsg, chatId: chatId, sessionId: sessionId })
                }

                resolve({ success: true })

            } else {
                console.log(`error found in sendChatTextMessage`, msg)
                resolve({
                    msg: "Unknown error found could not send messsage. Please try to re add instance",
                    err: msg?.toString()
                })
            }

        } catch (err) {
            resolve({ success: false, msg: err.toString(), err })
            console.log(err)
        }
    })
}

module.exports = {
    webhookIncoming,
    updateDelivery,
    sendTextMsg,
    sendMedia,
    sendPollMsg
}