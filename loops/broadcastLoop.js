const { query } = require('../database/dbpromise');
const { decodeObject, mergeVariables, encodeChatId, addObjectToFile } = require('../functions/function');
const { getSession, isExists } = require('../middlewares/req');
const { getIOInstance } = require('../socket');
const moment = require('moment-timezone');

function getRandomElementFromArray(array) {
    if (!array || array.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * array.length);
    return array[randomIndex];
}

function hasDatePassedInTimezone(timezone, datetimeFromMySQL) {
    if (!timezone || !datetimeFromMySQL) return true;
    try {
        const momentDate = moment.utc(datetimeFromMySQL).tz(timezone);
        if (!momentDate.isValid()) return false;
        const currentMoment = moment.tz(timezone);
        return momentDate.isBefore(currentMoment);
    } catch (e) {
        return true; 
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveTemplet(templet) {
    if (!templet) return null;
    const type = templet.type;
    const content = typeof templet.content === 'string' ? JSON.parse(templet.content) : templet.content;
    
    const getFilename = (raw) => {
        if (!raw) return "";
        return String(raw).split('/').pop();
    };
    
    switch (type) {
        case 'text': 
            return content;
        case 'image': 
            const imgName = getFilename(content?.filename || content?.url || content?.image?.url);
            return { 
                image: { url: `${__dirname}/../client/public/media/${imgName}` }, 
                caption: content?.legend || content?.caption || null,
                fileName: imgName,
                mimetype: "image/jpeg"
            };
        case 'doc': 
            const docName = getFilename(content?.filename || content?.url || content?.document?.url);
            return { 
                document: { url: `${__dirname}/../client/public/media/${docName}` }, 
                fileName: content?.originalName || content?.fileName || docName, 
                caption: content?.legend || content?.caption || null,
                mimetype: "application/pdf"
            };
        case 'aud': 
            const audName = getFilename(content?.filename || content?.url || content?.audio?.url);
            return { 
                audio: { url: `${__dirname}/../client/public/media/${audName}` }, 
                fileName: audName,
                mimetype: "audio/ogg",
                ptt: true 
            };
        case 'video': 
            const vidName = getFilename(content?.filename || content?.url || content?.video?.url);
            return { 
                video: { url: `${__dirname}/../client/public/media/${vidName}` }, 
                caption: content?.legend || content?.caption || null,
                fileName: vidName,
                mimetype: "video/mp4"
            };
        case 'loc': 
            return { 
                location: { degreesLatitude: content?.lat || content?.location?.degreesLatitude, degreesLongitude: content?.lng || content?.location?.degreesLongitude } 
            };
        case 'poll': 
            return content;
        default: 
            return null;
    }
}
/*

Nota:
Traté de hacer que los mensajes siempre fueran al mismo chat,osea que si alguien mandaba mensaje por un dispositivo vinculado, se guarda
como un @jid y si se le manda un broadcast, se guarda en el mismo chat, pero no funcionó, así que que cada mensaje de broadcast es un chat nuevo.

No es algo que se pueda corregir ya que no esta en nosotros como Whatsapp nos mande el id, no podemos saber si el mensaje que me enviaron
desde una pc es el mismo al que le mande mensaje por difusion

Entonces, si tenias un chat pero sin el numero  resgistrado (solo @jid), le mandas un broadcast y se crea un chat nuevo ahora si con el numero registrado,
borras el anterior chat y listo

*/

async function processPendingBroadcasts() {
    const broadcasts = await query(`SELECT * FROM broadcast WHERE status = ?`, ["PENDING"]);
    
    if (!broadcasts || broadcasts.length === 0) return false; 

    let processedAny = false;

    for (const b of broadcasts) {
        if (b.schedule && !hasDatePassedInTimezone(b.timezone, b.schedule)) {
            continue; 
        }

        const pendingLogs = await query(`SELECT * FROM broadcast_log WHERE broadcast_id = ? AND delivery_status = ? LIMIT 1`, [b.broadcast_id, "PENDING"]);

        if (pendingLogs.length === 0) {
            await query(`UPDATE broadcast SET status = ? WHERE broadcast_id = ?`, ["COMPLETED", b.broadcast_id]);
            console.log(`\n✅ [Broadcast] Campaña "${b.title}" finalizada con éxito.`);
            continue;
        }

        processedAny = true;
        const logObj = pendingLogs[0];

        try {
            console.log(`\n⏳ [Broadcast] Procesando envío a: ${logObj.send_to}...`);

            const insArr = JSON.parse(b.instance_id);
            const instanceId = getRandomElementFromArray(insArr);
            const session = await getSession(instanceId);

            if (!session) {
                console.log(`❌ [Broadcast] Instancia desconectada.`);
                await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`, ["Instance NA", "Session disconnected", logObj.id]);
                continue;
            }

            const rawNumber = String(logObj.send_to).replace(/\D/g, '');
            const jid = `${rawNumber}@s.whatsapp.net`;

            const [waCheck] = await session.onWhatsApp(jid);
            if (!waCheck || !waCheck.exists) {
                console.log(`❌ [Broadcast] El número ${rawNumber} no tiene WhatsApp.`);
                await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`, ["Number NA", "Not on WA", logObj.id]);
                continue;
            }

            const realJid = waCheck.jid; 

            const templet = JSON.parse(b.templet);
            const actualObj = resolveTemplet(templet);
            
            if (!actualObj) {
                console.log(`❌ [Broadcast] Plantilla inválida.`);
                await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`, ["failed", "Invalid template", logObj.id]);
                continue;
            }

            const contactData = JSON.parse(logObj.contact);
            const returnObjWithVariables = mergeVariables({
                content: actualObj,
                varJson: contactData,
                type: templet.type?.toLowerCase()
            });

            const send = await session.sendMessage(realJid, returnObjWithVariables);

            if (send?.key?.id) {
                const { client_id } = decodeObject(instanceId);
                await query(`UPDATE broadcast_log SET delivery_status = ?, msg_id = ?, instance_id = ? WHERE id = ?`, [
                    "sent", send.key.id, client_id, logObj.id
                ]);
                console.log(`✅ [Broadcast] Mensaje entregado con éxito a ${rawNumber}`);

                try {
                    const msgType = templet.type?.toLowerCase() === 'doc' ? 'document' : templet.type?.toLowerCase();
                    const timestamp = send.messageTimestamp?.low || Math.floor(Date.now() / 1000);

                    const allChats = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ?`, [b.uid, instanceId]);
                    const last10 = rawNumber.slice(-10);
                    
                    let checkChat = null;
                    
                    for (const c of allChats) {
                        try {
                            if (c.chat_id) {
                                const decodedStr = Buffer.from(c.chat_id, 'base64').toString('utf-8');
                                const decodedObj = JSON.parse(decodedStr);
                                if (decodedObj && decodedObj.num && String(decodedObj.num).includes(last10)) {
                                    checkChat = c;
                                    break;
                                }
                            }
                        } catch(e) {} 
                        
                        // B. Respaldo: Buscar en columnas normales por si es un chat nuevo
                        if ((c.sender_jid && String(c.sender_jid).includes(last10)) || 
                            (c.sender_mobile && String(c.sender_mobile).includes(last10))) {
                            checkChat = c;
                            break;
                        }
                    }

                    let chatId;
                    let targetJid = realJid;

                    if (checkChat) {
                        chatId = checkChat.chat_id;
                        targetJid = checkChat.sender_jid || realJid;
                    } else {
                        chatId = encodeChatId({ ins: instanceId, grp: false, num: realJid.replace('@s.whatsapp.net', '') });
                    }
                    const realContactName = contactData.name || rawNumber;

                    const saveObj = {
                        "group": false,
                        "type": msgType || "text",
                        "msgId": send.key.id,
                        "remoteJid": targetJid,
                        "msgContext": returnObjWithVariables,
                        "reaction": "",
                        "timestamp": timestamp,
                        // ✅ CORRECCIÓN: Usamos el nombre del contacto, no el de la campaña
                        "senderName": realContactName, 
                        "status": "sent",
                        "star": false,
                        "route": "outgoing",
                        "context": ""
                    };

                    // 2. Guardar en JSON (Disco duro)
                    const chatPath = `${__dirname}/../conversations/inbox/${b.uid}/${chatId}.json`;
                    addObjectToFile(saveObj, chatPath);

                    // 3. Actualizar SQL para mover el chat a la cima
                    if (checkChat) {
                        await query(`UPDATE chats SET last_message_came = ?, last_message = ? WHERE id = ?`, [
                            timestamp, JSON.stringify(saveObj), checkChat.id
                        ]);
                    } else {
                        // ✅ CORRECCIÓN: Al crear un chat nuevo, le ponemos el nombre real del contacto
                        await query(`INSERT INTO chats (chat_id, uid, last_message_came, sender_name, sender_mobile, sender_jid, last_message, instance_id) VALUES (?,?,?,?,?,?,?,?)`, [
                            chatId, b.uid, timestamp, realContactName, realJid.replace('@s.whatsapp.net', ''), realJid, JSON.stringify(saveObj), instanceId
                        ]);
                    }

                    // 4. ACTUALIZACIÓN EN TIEMPO REAL (SOCKET)
                    const io = getIOInstance();
                    if (io) {
                        const rooms = await query(`SELECT * FROM rooms WHERE uid = ?`, [b.uid]);
                        if (rooms.length > 0) {
                            const socketId = rooms[0].socket_id;
                            const updatedChats = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ? ORDER BY last_message_came DESC`, [b.uid, instanceId]);
                            io.to(socketId).emit('update_conversations', { chats: updatedChats, notificationOff: true });
                            io.to(socketId).emit('push_new_msg', { msg: saveObj, chatId: chatId, sessionId: instanceId });
                        }
                    }
                } catch(inboxErr) {
                    console.error(`⚠️ [Broadcast] Error al clonar en bandeja:`, inboxErr);
                }

            } else {
                console.log(`❌ [Broadcast] Fallo al enviar mensaje a ${rawNumber}`);
                await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`, [
                    "failed", "No message ID returned", logObj.id
                ]);
            }

        } catch (err) {
            console.error(`❌ [Broadcast] Error catastrófico enviando a ${logObj.send_to}:`, err);
            await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`, [
                "failed", err.toString(), logObj.id
            ]);
        }

        const dFrom = b.delay_from || 10;
        const dTo = b.delay_to || 30;
        const randomSecs = Math.floor(Math.random() * (dTo - dFrom + 1)) + dFrom;
        console.log(`⏱️ [Broadcast] Durmiendo ${randomSecs} segundos antes del próximo mensaje...`);
        await delay(randomSecs * 1000);
    }

    return processedAny;
}

async function broadcastLoopInit() {
    try {
        const processed = await processPendingBroadcasts();
        if (!processed) {
            await delay(5000);
        }
    } catch (err) {
        console.error("Error crítico en el loop principal:", err);
        await delay(5000); 
    } finally {
        broadcastLoopInit();
    }
}

module.exports = { broadcastLoopInit };