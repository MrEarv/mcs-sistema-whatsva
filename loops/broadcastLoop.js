const { query } = require('../database/dbpromise');
const { decodeObject, mergeVariables } = require('../functions/function');
const { getSession, isExists } = require('../middlewares/req');
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
        return true; // Si hay error de zona horaria, liberamos el envío
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Adaptamos el lector para que acepte tanto plantillas antiguas como las de nuestro nuevo Creador de Flujos
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
            return { 
                image: { url: `${__dirname}/../client/public/media/${getFilename(content?.filename || content?.url || content?.image?.url)}` }, 
                caption: content?.legend || content?.caption || null 
            };
        case 'doc': 
            return { 
                document: { url: `${__dirname}/../client/public/media/${getFilename(content?.filename || content?.url || content?.document?.url)}` }, 
                fileName: content?.originalName || content?.fileName, 
                caption: content?.legend || content?.caption || null 
            };
        case 'aud': 
            return { 
                audio: { url: `${__dirname}/../client/public/media/${getFilename(content?.filename || content?.url || content?.audio?.url)}` }, 
                ptt: true 
            };
        case 'video': 
            return { 
                video: { url: `${__dirname}/../client/public/media/${getFilename(content?.filename || content?.url || content?.video?.url)}` }, 
                caption: content?.legend || content?.caption || null 
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

async function processPendingBroadcasts() {
    const broadcasts = await query(`SELECT * FROM broadcast WHERE status = ?`, ["PENDING"]);
    
    if (!broadcasts || broadcasts.length === 0) return false; 

    let processedAny = false;

    for (const b of broadcasts) {
        // 1. Validar el horario
        if (b.schedule && !hasDatePassedInTimezone(b.timezone, b.schedule)) {
            continue; 
        }

        // 2. Extraer un solo log pendiente para esta campaña
        const pendingLogs = await query(`SELECT * FROM broadcast_log WHERE broadcast_id = ? AND delivery_status = ? LIMIT 1`, [b.broadcast_id, "PENDING"]);

        if (pendingLogs.length === 0) {
            // Si ya no hay logs pendientes, la campaña terminó
            await query(`UPDATE broadcast SET status = ? WHERE broadcast_id = ?`, ["COMPLETED", b.broadcast_id]);
            console.log(`\n✅ [Broadcast] Campaña "${b.title}" finalizada con éxito.`);
            continue;
        }

        processedAny = true;
        const logObj = pendingLogs[0];

        try {
            console.log(`\n⏳ [Broadcast] Procesando envío a: ${logObj.send_to}...`);

            // 3. Obtener la sesión de WhatsApp
            const insArr = JSON.parse(b.instance_id);
            const instanceId = getRandomElementFromArray(insArr);
            const session = await getSession(instanceId);

            if (!session) {
                console.log(`❌ [Broadcast] Instancia desconectada.`);
                await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`, ["Instance NA", "Session disconnected", logObj.id]);
                continue;
            }

// 4. Limpiar el número de teléfono
            const rawNumber = String(logObj.send_to).replace(/\D/g, '');
            const jid = `${rawNumber}@s.whatsapp.net`;

            // 5. Validar existencia y extraer el JID REAL (La magia para México 52 vs 521)
            const [waCheck] = await session.onWhatsApp(jid);
            
            if (!waCheck || !waCheck.exists) {
                console.log(`❌ [Broadcast] El número ${rawNumber} no tiene WhatsApp.`);
                await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`, ["Number NA", "Not on WA", logObj.id]);
                continue;
            }

            // WhatsApp nos corrige el número internamente (le agrega el 1 si es necesario)
            const realJid = waCheck.jid; 

            // 6. Preparar la plantilla y las variables
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

            // 7. Enviar el mensaje usando el número corregido (realJid)
            const send = await session.sendMessage(realJid, returnObjWithVariables);

            if (send?.key?.id) {
                const { client_id } = decodeObject(instanceId);
                await query(`UPDATE broadcast_log SET delivery_status = ?, msg_id = ?, instance_id = ? WHERE id = ?`, [
                    "sent", send.key.id, client_id, logObj.id
                ]);
                console.log(`✅ [Broadcast] Mensaje entregado con éxito a ${rawNumber}`);
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

        // 8. Retraso aleatorio para evitar baneos
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
            // Si no hay nada que procesar, el motor descansa 5 segundos y vuelve a buscar
            await delay(5000);
        }
    } catch (err) {
        console.error("🔥 [Broadcast Loop] Error crítico en el loop principal:", err);
        await delay(5000); 
    } finally {
        // LA MAGIA: Pase lo que pase, el motor se vuelve a llamar a sí mismo. JAMÁS MUERE.
        broadcastLoopInit();
    }
}

module.exports = { broadcastLoopInit };