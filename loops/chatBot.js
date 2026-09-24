const { decodeObject, daysDiff, readJsonFromFile, encodeChatId, removeNumberAfterColon, getImageAsBase64, replaceVariables } = require("../functions/function")
const { query } = require('../database/dbpromise');
const { sendMedia, sendTextMsg } = require("../functions/x");
const { delay } = require("@whiskeysockets/baileys");
// Memoria global mejorada
if (!global.userStates) {
    global.userStates = new Map();
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

    if (currentUserState && currentUserState.length > 0) {
        const contextualEdges = matchingEdges.filter(edge => currentUserState.includes(String(edge.source)));
        if (contextualEdges.length > 0) {
            matchingEdges = contextualEdges;
        } else {
            const otherEdges = edges.filter(edge => {
                const handle = String(edge.sourceHandle || "").trim().toLowerCase();
                return handle === "{{other_msg}}" && currentUserState.includes(String(edge.source));
            });
            if (otherEdges.length > 0) {
                matchingEdges = otherEdges;
            } else {
                return []; 
            }
        }
    } else {
        const targetIds = edges.map(e => String(e.target));
        const rootIds = nodes.filter(n => !targetIds.includes(String(n.id))).map(n => String(n.id));
        
        matchingEdges = matchingEdges.filter(edge => rootIds.includes(String(edge.source)));
    }

    const finalTargetIds = matchingEdges.map(edge => String(edge.target));
    return nodes.filter(node => finalTargetIds.includes(String(node.id)));
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

    const chatUserKey = `${uid}_${cleanJid}`; 
    let currentUserState = global.userStates.get(chatUserKey);

    if (currentUserState && currentUserState.length > 0) {
        const isValidState = currentUserState.some(stateId => nodes.some(node => String(node.id) === stateId));
        if (!isValidState) {
            global.userStates.delete(chatUserKey);
            currentUserState = null; 
        }
    }

    if (nodes.length > 0 && edges.length > 0) {
        const answer = getReply(nodes, edges, msg?.text, currentUserState);
        
        if (answer.length > 0) {
            const hasNextSteps = edges.some(edge => answer.some(node => String(node.id) === String(edge.source)));
            
            if (hasNextSteps) {
                global.userStates.set(chatUserKey, answer.map(node => String(node.id)));
            } else {
                global.userStates.delete(chatUserKey);
            }

            for (const k of answer) {
                let isGroup = cleanJid.endsWith("@g.us");
                let num = isGroup ? cleanJid.replace("@g.us", "") : cleanJid.replace("@s.whatsapp.net", "").replace("@lid", "");
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

                const { msgObj, saveObj, sendObj } = await makeObjs(msg, k);

                if (saveObj?.type === "text" || saveObj?.type === "poll") {
                    await delay(1000);
                    await sendTextMsg({
                        uid, msgObj, toJid: cleanJid, saveObj, chatId, session, sessionId
                    });
                } else {
                    if (saveObj?.type) {
                        await delay(1000);
                        await sendMedia({
                            uid, msgObj, toJid: cleanJid, saveObj, chatId, session, sessionId, sendObj
                        });
                    }
                }
            }
        }
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

        if (incomingText && !msg?.group) {
            const { uid, client_id } = decodeObject(sessionId)

            if (await checkPlan(uid)) {
                const chatbots = await query(`SELECT * FROM chatbot WHERE uid = ? AND active = ? AND instance_id = ?`, [uid, 1, sessionId]);

                if (chatbots.length > 0) {
                    await Promise.all(chatbots.map((i) => runChatbot(i, msg, uid, client_id, m, sessionId, session)));
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