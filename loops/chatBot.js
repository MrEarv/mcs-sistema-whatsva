const { decodeObject, daysDiff, readJsonFromFile, encodeChatId, removeNumberAfterColon, getImageAsBase64, replaceVariables, readJSONFile } = require("../functions/function")
const { query } = require('../database/dbpromise');
const { sendMedia, sendTextMsg } = require("../functions/x");
const { delay } = require("@whiskeysockets/baileys");
const fetch = require('node-fetch');
// Memoria global mejorada
if (!global.userStates) {
    global.userStates = new Map();
}

// Funcion para consultar a Ollama
async function generarRespuestaIA(mensajesEstructurados) {
    try {
        const response = await fetch("http://localhost:11434/api/chat", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "qwen2.5:3b",//        gemma2:2b           qwen2.5:3b    qwen2.5:0.5b   llama3.2:1b
                messages: mensajesEstructurados, // Ya no es un string largo, es un arreglo JSON
                stream: false,
                options: {
                    //num_predict: 100,   
                    temperature: 0.8   
                }
            })
        });
        const data = await response.json();
        return data.message.content; // La respuesta ahora viene en esta ruta
    } catch (error) {
        console.log("[Chatbot IA] Error de conexión con Ollama:", error);
        return "Hubo un error al consultar la información, permíteme un momento."; 
    }
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

function formatMobileNumber(identifier) {
    if (!identifier) {
        return "";
    }
    return '+' + (identifier.replace(/@(s\.whatsapp\.net|g\.us)/, ""));
}

async function convertMsg({ obj = {}, outgoing = false, pollMessage = "" }) {
    // console.log({ obj: JSON.stringify(obj) }convertMsg)
    const timestamp = Math.floor(Date.now() / 1000)

    // for image message 
    if (obj?.message?.imageMessage && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {
        if (obj?.key?.remoteJid?.endsWith("@g.us")) {
            return {
                group: true,
                type: "image",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                text: obj?.message?.imageMessage?.caption || "",
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming"
            }
        }
        if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
            return {
                group: false,
                type: "image",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                text: obj?.message?.imageMessage?.caption || "",
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming"
            }
        }
    }
    // for location message 
    else if (obj?.message?.locationMessage && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {
        if (obj?.key?.remoteJid?.endsWith("@g.us")) {
            return {
                group: true,
                type: "loc",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                    lat: obj?.message?.locationMessage?.degreesLatitude,
                    long: obj?.message?.locationMessage?.degreesLongitude,
                    name: obj?.message?.locationMessage?.name,
                    address: obj?.message?.locationMessage?.address
                },
                text: obj?.message?.locationMessage?.address || "",
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming",
                context: ""
            }
        }
        if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
            return {
                group: false,
                type: "loc",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                    lat: obj?.message?.locationMessage?.degreesLatitude,
                    long: obj?.message?.locationMessage?.degreesLongitude,
                    name: obj?.message?.locationMessage?.name,
                    address: obj?.message?.locationMessage?.address
                },
                text: obj?.message?.locationMessage?.address || "",
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming",
                context: ""
            }
        }
    }
    // for text and extended text messages 
    else if ((obj?.message?.conversation || obj?.message?.extendedTextMessage?.text) && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {
        
        const textContent = obj?.message?.conversation || obj?.message?.extendedTextMessage?.text;
        
        return {
            group: obj?.key?.remoteJid?.endsWith("@g.us"),
            type: "text",
            msgId: obj?.key?.id,
            remoteJid: obj?.key?.remoteJid,
            msgContext: {
                text: textContent
            },
            text: textContent || "",
            reaction: "",
            timestamp: obj?.messageTimestamp || timestamp,
            senderName: obj?.pushName || "Usuario",
            status: "sent",
            star: false,
            route: outgoing ? 'outgoing' : "incoming",
            context: ""
        }
    }
    // for video mesage 
    else if (obj?.message?.videoMessage && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {
        if (obj?.key?.remoteJid?.endsWith("@g.us")) {
            return {
                group: true,
                type: "video",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                },
                text: obj?.message?.videoMessage?.caption,
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming"
            }
        }
        if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
            return {
                group: false,
                type: "video",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                },
                text: obj?.message?.videoMessage?.caption,
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming",
            }
        }
    }
    // document message 
    // else if (obj?.message?.documentMessage && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {
    //     if (obj?.key?.remoteJid?.endsWith("@g.us")) {
    //         return {
    //             group: true,
    //             type: "doc",
    //             msgId: obj?.key?.id,
    //             remoteJid: obj?.key?.remoteJid,
    //             msgContext: {

    //             },
    //             text: "",
    //             reaction: "",
    //             timestamp: obj?.messageTimestamp || timestamp,
    //             senderName: obj?.pushName,
    //             status: "sent",
    //             star: false,
    //             route: outgoing ? 'outgoing' : "incoming"
    //         }
    //     }
    //     if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
    //         return {
    //             group: false,
    //             type: "doc",
    //             msgId: obj?.key?.id,
    //             remoteJid: obj?.key?.remoteJid,
    //             msgContext: {

    //             },
    //             text: "",
    //             reaction: "",
    //             timestamp: obj?.messageTimestamp || timestamp,
    //             senderName: obj?.pushName,
    //             status: "sent",
    //             star: false,
    //             route: outgoing ? 'outgoing' : "incoming"
    //         }
    //     }
    // }
    // audio message 
    // else if (obj?.message?.audioMessage && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {

    //     if (obj?.key?.remoteJid?.endsWith("@g.us")) {
    //         return {
    //             group: true,
    //             type: "aud",
    //             msgId: obj?.key?.id,
    //             remoteJid: obj?.key?.remoteJid,
    //             msgContext: {

    //             },
    //             text: "",
    //             timestamp: obj?.messageTimestamp || timestamp,
    //             senderName: obj?.pushName,
    //             status: "sent",
    //             star: false,
    //             route: outgoing ? 'outgoing' : "incoming"
    //         }
    //     }
    //     if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
    //         return {
    //             group: false,
    //             type: "aud",
    //             msgId: obj?.key?.id,
    //             remoteJid: obj?.key?.remoteJid,
    //             msgContext: {

    //             },
    //             text: "",
    //             reaction: "",
    //             timestamp: obj?.messageTimestamp || timestamp,
    //             senderName: obj?.pushName,
    //             status: "sent",
    //             star: false,
    //             route: outgoing ? 'outgoing' : "incoming"
    //         }
    //     }
    // }
    // document with caption 
    else if (obj?.message?.documentWithCaptionMessage && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {
        if (obj?.key?.remoteJid?.endsWith("@g.us")) {
            return {
                group: true,
                type: "doc_cap",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                },
                text: obj?.message?.documentWithCaptionMessage?.message?.documentMessage?.caption,
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming"
            }
        }
        if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
            return {
                group: false,
                type: "doc_cap",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                },
                text: obj?.message?.documentWithCaptionMessage?.message?.documentMessage?.caption,
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming"
            }
        }
    }
    // adding reaction 
    // else if (obj?.message?.reactionMessage) {
    //     if (obj?.key?.remoteJid?.endsWith("@g.us")) {
    //         return {
    //             group: true,
    //             type: "reaction",
    //             msgId: obj?.message?.reactionMessage?.key?.id,
    //             reaction: obj?.message?.reactionMessage?.text
    //         }
    //     }
    //     if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
    //         return {
    //             group: false,
    //             type: "reaction",
    //             msgId: obj?.message?.reactionMessage?.key?.id,
    //             reaction: obj?.message?.reactionMessage?.text
    //         }
    //     }
    // }

    // adding quotes text extended message 
    else if (obj?.message?.extendedTextMessage?.contextInfo?.stanzaId && obj?.key?.remoteJid !== "status@broadcast") {
        if (obj?.key?.remoteJid?.endsWith("@g.us")) {
            return {
                group: true,
                type: "text",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                    text: obj?.message?.extendedTextMessage?.text
                },
                text: obj?.message?.extendedTextMessage?.text,
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming",
                context: {
                    jid: obj?.message?.extendedTextMessage?.contextInfo?.participant,
                    id: obj?.message?.extendedTextMessage?.contextInfo?.stanzaId
                }
            }
        }
        if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
            return {
                group: false,
                type: "text",
                msgId: obj?.key?.id,
                remoteJid: obj?.key?.remoteJid,
                msgContext: {
                    text: obj?.message?.extendedTextMessage?.text
                },
                text: obj?.message?.extendedTextMessage?.text,
                reaction: "",
                timestamp: obj?.messageTimestamp || timestamp,
                senderName: obj?.pushName,
                status: "sent",
                star: false,
                route: outgoing ? 'outgoing' : "incoming",
                context: {
                    jid: obj?.message?.extendedTextMessage?.contextInfo?.participant,
                    id: obj?.message?.extendedTextMessage?.contextInfo?.stanzaId
                }
            }
        }
    }

    // for poll 
    else if (pollMessage && obj?.key?.remoteJid !== "status@broadcast" && obj?.key?.remoteJid) {

        const voter = extractVoters(pollMessage)

        if (voter?.length > 0) {
            if (obj?.key?.remoteJid?.endsWith("@g.us")) {
                return {
                    group: true,
                    type: "poll",
                    msgId: obj?.key?.id,
                    remoteJid: obj?.key?.remoteJid,
                    msgContext: {
                        text: voter[0]?.name
                    },
                    text: voter[0]?.name || "",
                    reaction: "",
                    timestamp: obj?.messageTimestamp || timestamp,
                    senderName: obj?.pushName,
                    status: "sent",
                    star: false,
                    route: outgoing ? 'outgoing' : "incoming",
                    context: ""
                }
            }
            if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
                return {
                    group: false,
                    type: "poll",
                    msgId: obj?.key?.id,
                    remoteJid: obj?.key?.remoteJid,
                    msgContext: {
                        text: voter[0]?.name
                    },
                    text: voter[0]?.name || "",
                    reaction: "",
                    timestamp: obj?.messageTimestamp || timestamp,
                    senderName: obj?.pushName,
                    status: "sent",
                    star: false,
                    route: outgoing ? 'outgoing' : "incoming",
                    context: ""
                }
            }
        }
    }

    else {
        return null
    }
}
// funcion findtargetNodes fusionada con getreply
function getReply(nodes, edges, incomingWord, currentUserState) {
    const safeWord = String(incomingWord || "").trim().toLowerCase();

    let matchingEdges = edges.filter(edge => {
        const handle = String(edge.sourceHandle || "").trim().toLowerCase();
        return handle === safeWord;
    });

    const targetIds = edges.map(e => String(e.target));
    const rootIds = nodes.filter(n => !targetIds.includes(String(n.id))).map(n => String(n.id));

    // 1. PRIORIDAD MÁXIMA: Palabras clave de inicio globales (ej. "Hola", "Menu")
    // Si el usuario escribe una palabra raíz, lo saca de cualquier trampa y resetea el flujo.
    // Esto SIEMPRE es una respuesta de guion válida: nunca pasa por la IA.
    let rootEdges = matchingEdges.filter(edge => rootIds.includes(String(edge.source)));
    if (rootEdges.length > 0) {
        const finalTargetIds = rootEdges.map(edge => String(edge.target));
        return {
            nodes: nodes.filter(node => finalTargetIds.includes(String(node.id))),
            isFallback: false
        };
    }

    // 2. BÚSQUEDA CONTEXTUAL (Si está atorado en una encuesta o menú)
    if (currentUserState && currentUserState.length > 0) {
        // A) Busca si la respuesta es una opción válida (ej. "1" o "2") -> guion válido, NO es IA.
        const contextualEdges = matchingEdges.filter(edge => currentUserState.includes(String(edge.source)));

        if (contextualEdges.length > 0) {
            const finalTargetIds = contextualEdges.map(edge => String(edge.target));
            return {
                nodes: nodes.filter(node => finalTargetIds.includes(String(node.id))),
                isFallback: false
            };
        }

        // B) Se equivocó: si hay una salida {{OTHER_MSG}} local dibujada para ESE menú, se usa ese nodo.
        //    De cualquier forma, es un caso "fuera de guion" -> isFallback = true.
        const localFallback = edges.filter(edge => {
            const handle = String(edge.sourceHandle || "").trim().toLowerCase();
            return handle === "{{other_msg}}" && currentUserState.includes(String(edge.source));
        });

        const finalTargetIds = localFallback.map(edge => String(edge.target));
        return {
            nodes: nodes.filter(node => finalTargetIds.includes(String(node.id))),
            isFallback: true
        };
    }

    // 3. SIN ESTADO ACTUAL: no hay menú pendiente y la palabra no coincidió con ningún nodo raíz.
    // Si existe una salida {{OTHER_MSG}} global dibujada en el flujo, se usa ese nodo; si no, igual
    // es fuera de guion -> isFallback = true (el llamador puede responder con la IA sin nodo).
    const globalFallback = edges.filter(edge => {
        const handle = String(edge.sourceHandle || "").trim().toLowerCase();
        return handle === "{{other_msg}}" && rootIds.includes(String(edge.source));
    });

    const finalTargetIds = globalFallback.map(edge => String(edge.target));
    return {
        nodes: nodes.filter(node => finalTargetIds.includes(String(node.id))),
        isFallback: true
    };
}

async function checkPlan(uid) {
    const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid])
    if (!user.plan) {
        return false
    }
    const plan = JSON.parse(user?.plan)
    const daysLeft = daysDiff(user.plan_expire)
    if (daysLeft < 1 || parseInt(plan?.chatbot) < 1) {
        return false
    } else {
        return true
    }
}

async function makeObjs(msg, k) {
    const type = k?.nodeType

    if (type === 'text') {
        const msgObj = {
            text: replaceVariables(k?.msgContent?.text, {
                name: msg?.senderName,
                mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid
            }) || k?.msgContent?.text
        }

        const saveObj = {
            "group": false,
            "type": "text",
            "msgId": "",
            "remoteJid": msg?.remoteJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": msg?.senderName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const sendObj = {}

        return {
            msgObj,
            saveObj,
            sendObj
        }
    } else if (type === 'image') {
        const sendObj = {
            image: {
                url: `${__dirname}/../client/public/media/${k?.msgContent?.image?.url}`
            },

            caption: replaceVariables(k?.msgContent?.caption, {
                name: msg?.senderName,
                mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid
            })
                || k?.msgContent?.caption || null,


            fileName: k?.msgContent?.image?.url,
            jpegThumbnail: getImageAsBase64(`${__dirname}/../client/public/media/${k?.msgContent?.image?.url}`)
        }

        const msgObj = {

            caption: replaceVariables(k?.msgContent?.caption, {
                name: msg?.senderName,
                mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid
            })
                || k?.msgContent?.caption || "",

            fileName: k?.msgContent?.image?.url,
            "mimetype": k?.msgContent?.mimetype
        }

        const saveObj = {
            "group": false,
            "type": "image",
            "msgId": "",
            "remoteJid": msg?.remoteJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": msg?.senderName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        return {
            sendObj,
            msgObj,
            saveObj
        }
    } else if (type === 'doc') {

        const sendObj = {
            document: {
                url: `${__dirname}/../client/public/media/${k?.msgContent?.document?.url}`
            },

            caption: replaceVariables(k?.msgContent?.caption, {
                name: msg?.senderName,
                mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid
            })
                || k?.msgContent?.caption || null,

            fileName: k?.msgContent?.fileName
        }

        const msgObj = {

            caption: replaceVariables(k?.msgContent?.caption, {
                name: msg?.senderName,
                mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid
            })
                || k?.msgContent?.caption || null,

            fileName: k?.msgContent?.fileName,
            "mimetype": k?.data?.state?.mime || ""
        }

        const saveObj = {
            "group": false,
            "type": type,
            "msgId": "",
            "remoteJid": msg?.remoteJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": msg?.senderName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        return {
            sendObj,
            msgObj,
            saveObj
        }
    } else if (type === 'location') {

        const sendObj = {
            location: {
                degreesLatitude: k?.msgContent?.location?.degreesLatitude,
                degreesLongitude: k?.msgContent?.location?.degreesLongitude
            }
        }

        const msgObj = {
            lat: k?.msgContent?.location?.degreesLatitude,
            long: k?.msgContent?.location?.degreesLongitude,
            "name": "",
            "address": ""
        }

        const saveObj = {
            "group": false,
            "type": "loc",
            "msgId": "",
            "remoteJid": msg?.remoteJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": msg?.senderName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        return {
            sendObj,
            msgObj,
            saveObj
        }
    } else if (type === 'aud') {

        const sendObj = {
            audio: {
                url: `${__dirname}/../client/public/media/${k?.msgContent?.audio?.url}`
            },
            fileName: k?.msgContent?.fileName,
            ptt: true
        }

        const msgObj = {
            caption: "",
            fileName: k?.msgContent?.fileName,
            mimetype: k?.msgContent?.data?.state?.mime || ""
        }

        const saveObj = {
            "group": false,
            "type": "aud",
            "msgId": "",
            "remoteJid": msg?.remoteJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": msg?.senderName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        return {
            sendObj,
            msgObj,
            saveObj
        }
    } else if (type === 'video') {

        const sendObj = {
            video: {
                url: `${__dirname}/../client/public/media/${k?.msgContent?.video?.url}`
            },

            caption: replaceVariables(k?.msgContent?.caption, {
                name: msg?.senderName,
                mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid
            })
                || k?.msgContent?.caption || null
        }

        const msgObj = {
            caption: replaceVariables(k?.msgContent?.caption, {
                name: msg?.senderName,
                mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid
            })
                || k?.msgContent?.caption || "",
            mimetype: k?.data?.state?.mime
        }

        const saveObj = {
            "group": false,
            "type": "video",
            "msgId": "",
            "remoteJid": msg?.remoteJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": msg?.senderName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        return {
            sendObj,
            msgObj,
            saveObj
        }
    } else if (type === 'poll') {

        const pollContent = k?.msgContent?.poll || k?.msgContent?.pollCreate || {}
        const question = pollContent.name || k?.msgContent?.question || k?.data?.state?.question || ''
        const options = Array.isArray(pollContent.values)
            ? pollContent.values
            : (Array.isArray(pollContent.options)
                ? pollContent.options
                : (Array.isArray(k?.data?.state?.options) ? k.data.state.options : []))
        const msgObj = {
            text: [question, ...options.map((option, index) => `${index + 1}. ${option}`)]
                .filter(Boolean)
                .join('\n')
        }

        const saveObj = {
            "group": false,
            "type": "text",
            "msgId": "",
            "remoteJid": msg?.remoteJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": msg?.senderName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const sendObj = {}

        return {
            msgObj,
            saveObj,
            sendObj
        }
    } else {
        return {
            sendObj: {},
            msgObj: {},
            saveObj: {}
        }
    }
}

// Arma el prompt de sistema + el historial reciente en el formato que espera
function buildMensajesIA(uid, chatId, msg, promptDinamico) {
    const personalidad = promptDinamico || `Eres un asistente virtual útil y breve.`;
    // Reglas internas default
    const reglasSistema = `
        REGLAS ESTRICTAS DEL SISTEMA (INQUEBRANTABLES):
        1. Tu respuesta final DEBE SER EXTREMADAMENTE CORTA (máximo 20 palabras). 
        2. Sé directo y conciso. Termina tus oraciones rápidamente.
        3. FORMATO ESTRICTO: Interfaz SMS clásica. Utiliza exclusivamente letras, números y signos de puntuación básicos.
        4. CERO EMOJIS. No uses caritas, símbolos ni asteriscos.
    `;
    const contextoFinal = `${personalidad}\n\n${reglasSistema}`;

    let mensajesChat = [{ role: "system", content: contextoFinal }];

    const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;
    const historialRaw = readJSONFile(chatPath, 8);

    historialRaw.forEach(h => {
        let pastText = h.msgContext?.text || h.text || h.body || h.message || "";

        if (!pastText && h.msgContext?.pollCreationMessage) {
            pastText = h.msgContext.pollCreationMessage.name;
        }

        if (!pastText) {
            if (h.msgContext?.stickerMessage) pastText = "[Sticker]";
            else if (h.msgContext?.imageMessage) pastText = "[Imagen]";
        }

        if (pastText && typeof pastText === 'string') {
            mensajesChat.push({
                role: h.route === 'incoming' ? 'user' : 'assistant',
                content: pastText
            });
        }
    }); 

    let textoActual = msg?.text;
    if (!textoActual) {
        if (msg?.message?.stickerMessage) textoActual = "[Sticker]";
        else if (msg?.message?.imageMessage) textoActual = "[Foto]";
        else textoActual = "[Multimedia]";
    }
    mensajesChat.push({ role: "user", content: textoActual });

    return mensajesChat;
}

// Resuelve el chat_id de MySQL para un JID limpio, igual que en extractData/x.js:
// compara por los últimos 10 dígitos para unificar variantes del mismo número.
async function resolveChatId(uid, sessionId, cleanJid) {
    const isGroup = cleanJid.endsWith("@g.us");
    const num = isGroup ? cleanJid.replace("@g.us", "") : cleanJid.replace("@s.whatsapp.net", "").replace("@lid", "");
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

    return chatId;
}

// Consulta a Ollama y envía la respuesta como un mensaje de texto normal.
// Se usa tanto cuando el mensaje no cae en ningún nodo raíz del flujo, como
// cuando el usuario está dentro de un flujo y responde algo fuera de las
// opciones válidas de ese menú.
async function responderConIA({ uid, cleanJid, chatId, msg, session, sessionId, chatbotData }) {
    console.log(`[Chatbot IA] Mensaje fuera de guion detectado. Consultando a Ollama...`);

    await session.sendPresenceUpdate('composing', cleanJid);

    const mensajesChat = buildMensajesIA(uid, chatId, msg, chatbotData?.ai_prompt);

    console.log("[Chatbot IA] Memoria ensamblada:", mensajesChat);

    const respuestaIA = await generarRespuestaIA(mensajesChat);

    await session.sendPresenceUpdate('paused', cleanJid);

    const msgObj = { text: respuestaIA };
    const saveObj = {
        "group": false,
        "type": "text",
        "msgId": "",
        "remoteJid": cleanJid,
        "msgContext": msgObj,
        "reaction": "",
        "timestamp": "",
        "senderName": msg?.senderName,
        "status": "sent",
        "star": false,
        "route": "outgoing",
        "context": ""
    };

    await delay(1000);
    await sendTextMsg({
        uid, msgObj, toJid: cleanJid, saveObj, chatId, session, sessionId
    });
}

async function runChatbot(i, msg, uid, client_id, m, sessionId, session) {
    const chatbot = i;
    const flow = JSON.parse(chatbot?.flow);

    const nodePath = `${__dirname}/../flow-json/nodes/${uid}/${flow?.flow_id}.json`;
    const edgePath = `${__dirname}/../flow-json/edges/${uid}/${flow?.flow_id}.json`;

    const nodes = readJsonFromFile(nodePath);
    const edges = readJsonFromFile(edgePath);

    let cleanJid = removeNumberAfterColon(msg?.remoteJid || "");
    if (cleanJid.includes('@lid')) {
        const fs = require('fs');
        const path = require('path');
        const mapPath = path.join(__dirname, `../conversations/${uid}_lids.json`);
        if (fs.existsSync(mapPath)) {
            const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            if (map[cleanJid]) {
                cleanJid = map[cleanJid];
            }
        }
    }

    msg.remoteJid = cleanJid;

    const chatUserKey = `${uid}_${sessionId}_${cleanJid}`;
    let currentUserState = global.userStates.get(chatUserKey);

    if (currentUserState && currentUserState.length > 0) {
        const isValidState = currentUserState.some(stateId => nodes.some(node => String(node.id) === stateId));
        if (!isValidState) {
            global.userStates.delete(chatUserKey);
            currentUserState = null;
        }
    }

    const chatId = await resolveChatId(uid, sessionId, cleanJid);

    let answer = [];
    let isFallback = true;

    if (nodes.length > 0 && edges.length > 0) {
        const result = getReply(nodes, edges, msg?.text, currentUserState);
        answer = result.nodes;
        isFallback = result.isFallback;
    }

    if (!isFallback) {
        const hasNextSteps = edges.some(edge => answer.some(node => String(node.id) === String(edge.source)));

        if (hasNextSteps) {
            global.userStates.set(chatUserKey, answer.map(node => String(node.id)));
        } else {
            global.userStates.delete(chatUserKey);
        }

        for (const k of answer) {
            const { msgObj, saveObj, sendObj } = await makeObjs(msg, k);

            if (saveObj?.type === "text" || saveObj?.type === "poll") {
                await delay(1000);
                await sendTextMsg({
                    uid, msgObj, toJid: cleanJid, saveObj, chatId, session, sessionId
                });
            } else if (saveObj?.type) {
                await delay(1000);
                await sendMedia({
                    uid, msgObj, toJid: cleanJid, saveObj, chatId, session, sessionId, sendObj
                });
            }
        }
    } else {
        await responderConIA({ uid, cleanJid, chatId, msg, session, sessionId, chatbotData: chatbot });
    }
}

async function chatbotInit(m, wa, sessionId, session, pollMessage) {
    try {
        const msg = await convertMsg({
            obj: m?.messages[0],
            pollMessage: pollMessage
        })

        const incomingText = msg?.text

        console.log({
            incomingText: incomingText
        })

        if (msg && !msg?.group) {
            const { uid, client_id } = decodeObject(sessionId)

            if (await checkPlan(uid)) {
                const chatbots = await query(`SELECT * FROM chatbot WHERE uid = ? AND active = ? AND instance_id = ?`, [uid, 1, sessionId]);

                if (chatbots.length > 0) {
                        await Promise.all(chatbots.map(async (i) => {
                            
                            let shouldReply = true;
                            const isForAll = i.for_all === 1 || i.for_all === '1' || i.for_all === true;

                            if (!isForAll && i.prevent_book_id) {
                                const msgKey = m?.messages?.[0]?.key || {};
                                
                                const rawJid = msgKey.remoteJidAlt || msgKey.remoteJid || msgKey.participant || "";
                                
                                const senderNumber = rawJid.split('@')[0].replace(/\D/g, '');
                                const last10 = senderNumber.slice(-10);
                                
                                console.log(`[Chatbot Debug] Evaluando a ${last10}`);

                                if (last10.length >= 10) {
                                    const excluded = await query(
                                        `SELECT id FROM contact WHERE uid = ? AND phonebook_id = ? AND mobile LIKE ?`, 
                                        [uid, i.prevent_book_id, `%${last10}%`]
                                    );
                                    
                                    if (excluded.length > 0) {
                                        shouldReply = false;
                                        console.log(`[Chatbot Debug] El número está en la agenda de exclusión.`);
                                    } else {
                                        console.log(`[Chatbot Debug] Permitiendo respuesta...`);
                                    }
                                }
                            }
                            if (shouldReply) {
                                return runChatbot(i, msg, uid, client_id, m, sessionId, session);
                            }
                        }));
                    }

            } else {
                await query(`UPDATE chatbot SET active = ? WHERE uid = ?`, [0, uid])
                console.log("Either user has no plan or plan without bot")
            }
        }
    } catch (err) {
        console.log(err)
    }
}

module.exports = { chatbotInit }