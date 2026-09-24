const router = require('express').Router()
const { query } = require('../database/dbpromise.js')
const bcrypt = require('bcrypt')
const { sign } = require('jsonwebtoken')
const validateUser = require('../middlewares/user.js')
const moment = require('moment')
const { isValidEmail, encodeObject, deleteFileIfExists, getImageAsBase64, convertTempletObj } = require('../functions/function.js')
const randomstring = require('randomstring')
const { createSession, sendMessage, getSession, formatPhone, getChatList } = require('../middlewares/req.js')
const { fetchPersonStatus, fetchProfileUrl, fetchBusinessprofile, fetchGroupMeta } = require('../functions/control.js')
const { sendTextMsg, sendMedia, sendPollMsg } = require('../functions/x.js')
const mime = require('mime-types');
const { checkPlanExpiry } = require('../middlewares/planValidator.js')
const fs = require('fs');
const path = require('path');

// Helper universal para extraer el payload sin importar cómo lo envíe React (body, data.body, etc.)
const extractPayload = (req) => req.body?.data?.body || req.body?.body || req.body?.data || req.body;

// Helper para encontrar archivos multimedia si el nombre no coincide exactamente
const resolveMediaFileName = (inputName) => {
    const mediaDir = `${__dirname}/../client/public/media`;
    if (inputName && fs.existsSync(`${mediaDir}/${inputName}`)) {
        return inputName;
    }
    try {
        const files = fs.readdirSync(mediaDir);
        if (files.length > 0) {
            files.sort((a, b) => fs.statSync(`${mediaDir}/${b}`).mtimeMs - fs.statSync(`${mediaDir}/${a}`).mtimeMs);
            return files[0];
        }
    } catch (e) {
        console.error("Error al buscar archivo en media:", e);
    }
    return inputName;
};

// get my chats 
router.get("/get_my_chats", validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { instance } = req.query;
        let selIns;

        const userInstances = await query(`SELECT * FROM instance WHERE uid = ?`, [req.decode.uid]);

        if (!userInstances || userInstances.length === 0) {
            return res.json({ success: false, msg: "No tienes ninguna instancia conectada." });
        }

        const getSessionId = (title) => encodeObject({ uid: req.decode.uid, client_id: title });

        if (instance) {
            selIns = instance;
        } else if (req?.user?.opened_chat_instance) {
            selIns = req?.user?.opened_chat_instance;
            const isValid = userInstances.some(inst => getSessionId(inst.title) === selIns);
            if (!isValid) {
                selIns = getSessionId(userInstances[0].title);
            }
        } else {
            selIns = getSessionId(userInstances[0].title);
        }

        await query(`UPDATE user SET opened_chat_instance = ? WHERE uid = ?`, [
            selIns,
            req.decode.uid
        ]);

        let session = await getSession(selIns);

        const userData = session 
            ? (session?.authState?.creds?.me || session.user) 
            : { id: 'Desconectado', name: 'Sesión Inactiva' };

        const data = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ? ORDER BY last_message_came DESC`, [
            req.decode.uid,
            selIns
        ]);
        
        res.json({ data, success: true, userData: { ...userData, selIns } });

    } catch (err) {
        console.log("Error en /get_my_chats:", err);
        res.json({ success: false, msg: "something went wrong", err: err.message || err });
    }
});


// send text message 
router.post('/send_text', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const { text, toJid, toName, chatId, instance } = payload;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!text || !finalToJid || !instance) {
            return res.json({ success: false, msg: "Not enough input provided" });
        }

        const msgObj = { text };
        const uid = req.decode.uid;

        const saveObj = {
            "group": false,
            "type": "text",
            "msgId": "",
            "remoteJid": finalToJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName || "Usuario",
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        };

        const session = await getSession(instance);

        const resp = await sendTextMsg({
            uid,
            msgObj,
            toJid: finalToJid,
            saveObj,
            chatId: finalChatId,
            session,
            sessionId: instance
        });

        res.json(resp);

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// send image msg 
router.post('/send_image', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        
        const caption = payload.caption || payload.text || "";
        const toJid = payload.toJid || payload.remoteJid || payload.jid || payload.receiver;
        const toName = payload.toName || payload.name || payload.senderName || "Usuario";
        const chatId = payload.chatId || payload.chat_id || payload.id;
        const instance = payload.instance || payload.sessionId || payload.instance_id;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!finalToJid || !finalChatId || !instance) {
            return res.json({ success: false, msg: "Faltan datos de destino (toJid, chatId o instance)" });
        }

        let imageName = payload.image || payload.fileName || payload.file || payload.originalFile;
        imageName = resolveMediaFileName(imageName);

        const mediaDir = `${__dirname}/../client/public/media`;
        const sendObj = {
            image: { url: `${mediaDir}/${imageName}` },
            caption: caption || null,
            fileName: imageName,
            jpegThumbnail: getImageAsBase64(`${mediaDir}/${imageName}`)
        };

        const msgObj = {
            caption: caption,
            fileName: imageName,
            "mimetype": mime.lookup(imageName) || "image/jpeg"
        };

        const uid = req.decode.uid;
        const saveObj = {
            "group": false,
            "type": "image",
            "msgId": "",
            "remoteJid": finalToJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        };

        const session = await getSession(instance);
        const resp = await sendMedia({
            uid,
            msgObj,
            toJid: finalToJid,
            saveObj,
            chatId: finalChatId,
            session,
            sessionId: instance,
            sendObj
        });

        res.json(resp);

    } catch (err) {
        console.log("Error en /send_image:", err);
        res.json({ success: false, msg: "something went wrong", err: err.message || err });
    }
});


// send video 
router.post('/send_video', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        
        const caption = payload.caption || payload.text || "";
        const toJid = payload.toJid || payload.remoteJid || payload.jid;
        const toName = payload.toName || payload.name || "Usuario";
        const chatId = payload.chatId || payload.chat_id || payload.id;
        const instance = payload.instance || payload.sessionId || payload.instance_id;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!finalToJid || !finalChatId || !instance) {
            return res.json({ success: false, msg: "Faltan datos de destino" });
        }

        let fileName = payload.fileName || payload.image || payload.file || payload.originalFile;
        fileName = resolveMediaFileName(fileName);

        const mediaDir = `${__dirname}/../client/public/media`;
        const sendObj = {
            video: { url: `${mediaDir}/${fileName}` },
            caption: caption || null,
            fileName: fileName
        };

        const msgObj = {
            caption: caption || "",
            fileName: fileName,
            mimetype: mime.lookup(fileName) || "video/mp4"
        };

        const uid = req.decode.uid;
        const saveObj = {
            "group": false,
            "type": "video",
            "msgId": "",
            "remoteJid": finalToJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        };

        const session = await getSession(instance);
        const resp = await sendMedia({
            uid, msgObj, toJid: finalToJid, saveObj, chatId: finalChatId, session, sessionId: instance, sendObj
        });

        res.json(resp);

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// send doc 
router.post('/send_doc', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        
        const caption = payload.caption || "";
        const toJid = payload.toJid || payload.remoteJid || payload.jid;
        const toName = payload.toName || "Usuario";
        const chatId = payload.chatId || payload.id;
        const instance = payload.instance || payload.sessionId;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!finalToJid || !instance) {
            return res.json({ success: false, msg: "Faltan datos de destino" });
        }

        let fileName = payload.fileName || payload.file || payload.originalFile;
        fileName = resolveMediaFileName(fileName);

        const mediaDir = `${__dirname}/../client/public/media`;
        const sendObj = {
            document: { url: `${mediaDir}/${fileName}` },
            caption: caption || null,
            fileName: fileName
        };

        const msgObj = {
            caption: caption || "",
            fileName: fileName,
            mimetype: mime.lookup(fileName) || "application/pdf"
        };

        const uid = req.decode.uid;
        const saveObj = {
            "group": false, "type": "doc", "msgId": "", "remoteJid": finalToJid, "msgContext": msgObj,
            "reaction": "", "timestamp": "", "senderName": toName, "status": "sent", "star": false, "route": "outgoing", "context": ""
        };

        const session = await getSession(instance);
        const resp = await sendMedia({ uid, msgObj, toJid: finalToJid, saveObj, chatId: finalChatId, session, sessionId: instance, sendObj });

        res.json(resp);

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// send audio 
router.post('/send_aud', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const toJid = payload.toJid || payload.remoteJid || payload.jid;
        const toName = payload.toName || "Usuario";
        const chatId = payload.chatId || payload.id;
        const instance = payload.instance || payload.sessionId;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!finalToJid || !instance) {
            return res.json({ success: false, msg: "Faltan datos de destino" });
        }

        let fileName = payload.fileName || payload.file || payload.originalFile;
        fileName = resolveMediaFileName(fileName);

        const mediaDir = `${__dirname}/../client/public/media`;
        const sendObj = {
            audio: { url: `${mediaDir}/${fileName}` },
            fileName: fileName,
            ptt: true
        };

        const msgObj = {
            caption: "",
            fileName: fileName,
            mimetype: mime.lookup(fileName) || "audio/ogg"
        };

        const uid = req.decode.uid;
        const saveObj = {
            "group": false, "type": "aud", "msgId": "", "remoteJid": finalToJid, "msgContext": msgObj,
            "reaction": "", "timestamp": "", "senderName": toName, "status": "sent", "star": false, "route": "outgoing", "context": ""
        };

        const session = await getSession(instance);
        const resp = await sendMedia({ uid, msgObj, toJid: finalToJid, saveObj, chatId: finalChatId, session, sessionId: instance, sendObj });

        res.json(resp);

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// send location 
router.post('/send_loc', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const toJid = payload.toJid || payload.remoteJid || payload.jid;
        const toName = payload.toName || "Usuario";
        const chatId = payload.chatId || payload.id;
        const instance = payload.instance || payload.sessionId;
        const lat = payload.lat;
        const long = payload.long;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!finalToJid || !instance || !lat || !long) {
            return res.json({ success: false, msg: "Please write all fields" });
        }

        const sendObj = {
            location: { degreesLatitude: lat, degreesLongitude: long }
        };

        const msgObj = { lat, long, "name": "", "address": "" };
        const uid = req.decode.uid;
        const saveObj = {
            "group": false, "type": "loc", "msgId": "", "remoteJid": finalToJid, "msgContext": msgObj,
            "reaction": "", "timestamp": "", "senderName": toName, "status": "sent", "star": false, "route": "outgoing", "context": ""
        };

        const session = await getSession(instance);
        const resp = await sendMedia({ uid, msgObj, toJid: finalToJid, saveObj, chatId: finalChatId, session, sessionId: instance, sendObj });

        res.json(resp);

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// send poll message 
router.post('/send_poll', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const toJid = payload.toJid || payload.remoteJid || payload.jid;
        const toName = payload.toName || "Usuario";
        const chatId = payload.chatId || payload.id;
        const instance = payload.instance || payload.sessionId;
        const name = payload.name;
        const values = payload.values;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!finalToJid || !instance) {
            return res.json({ success: false, msg: "Invalid request" });
        }

        if (!name || !values || values.length < 2) {
            return res.json({ msg: "At least 2 options are required" });
        }

        const msgObj = {
            poll: {
                name: name?.slice(0, 230),
                values: values,
                selectableCount: 1
            }
        };

        const uid = req.decode.uid;
        const saveObj = {
            "group": false, "type": "poll", "msgId": "", "remoteJid": finalToJid, "msgContext": msgObj,
            "reaction": "", "timestamp": "", "senderName": toName, "status": "sent", "star": false, "route": "outgoing", "context": ""
        };

        const session = await getSession(instance);
        const resp = await sendTextMsg({ uid, msgObj, toJid: finalToJid, saveObj, chatId: finalChatId, session, sessionId: instance });

        res.json(resp);

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// del chat 
router.post('/del_chat', validateUser, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const chatId = payload.chatId || payload.id;

        if (!chatId) {
            return res.json({ msg: "Please provide chat id" });
        }

        await query(`DELETE FROM chats WHERE chat_id = ?`, [chatId]);

        const filePath = `${__dirname}/../conversations/inbox/${req.decode.uid}/${chatId}.json`;
        deleteFileIfExists(filePath);

        res.json({ msg: "Chat was deleted", success: true });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// getting sender details 
router.post('/get_sender_details', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const sessionId = payload.sessionId || payload.instance;
        const jid = payload.jid;

        if (!sessionId || !jid) {
            return res.json({ msg: "Invalid request" });
        }

        const session = await getSession(sessionId);
        if (!session) {
            return res.json({ msg: "This session is busy could not fetch the details" });
        }

        const status = await fetchPersonStatus(session, jid);
        const profilePhoto = await fetchProfileUrl(session, jid);

        res.json({ success: true, status, profilePhoto });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// get group meta data info 
router.post('/get_group_meta', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const sessionId = payload.sessionId || payload.instance;
        const jid = payload.jid;

        if (!sessionId || !jid) {
            return res.json({ msg: "Invalid request" });
        }

        const session = await getSession(sessionId);
        if (!session) {
            return res.json({ msg: "This session is busy could not fetch the details" });
        }

        const groupData = await fetchGroupMeta(session, jid);
        const profilePhoto = await fetchProfileUrl(session, jid);

        res.json({ success: true, profilePhoto, groupData });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// get chat note 
router.post("/get_chat_note", validateUser, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const chatId = payload.chatId || payload.id;

        const getChat = await query(`SELECT * FROM chats WHERE chat_id = ? AND uid = ?`, [
            chatId,
            req.decode.uid
        ]);

        res.json({ success: true, data: getChat[0]?.chat_note || "" });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// update chat note 
router.post('/update_chat_note', validateUser, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const chatId = payload.chatId || payload.id;
        const note = payload.note;

        await query(`UPDATE chats SET chat_note = ? WHERE chat_id = ? AND uid = ?`, [
            note,
            chatId,
            req.decode.uid
        ]);

        res.json({ success: true, msg: "Note updated" });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// get msg Votes 
router.post('/get_poll_votes', validateUser, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const msgId = payload.msgId || payload.id;

        const data = await query(`SELECT * FROM poll_votes WHERE msg_id = ? AND uid = ?`, [
            msgId,
            req.decode.uid
        ]);

        res.json({ data, success: true });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// send templet 
router.post('/send_templet', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const id = payload.id;
        const toJid = payload.toJid || payload.remoteJid || payload.jid;
        const toName = payload.toName || "Usuario";
        const chatId = payload.chatId || payload.id;
        const instance = payload.instance || payload.sessionId;

        const finalToJid = toJid || chatId;
        const finalChatId = chatId || toJid;

        if (!finalToJid || !instance || !id) {
            return res.json({ success: false, msg: "Not enough input provided" });
        }

        const getTemplet = await query(`SELECT * FROM templets WHERE id = ? AND uid = ?`, [id, req.decode.uid]);

        if (getTemplet.length < 1) {
            return res.json({ msg: "Templet not found" });
        }

        const templetContet = JSON.parse(getTemplet[0]?.content);
        const templetType = getTemplet[0]?.type;

        const { sendObj, msgObj, type } = await convertTempletObj(templetContet, templetType);

        const uid = req.decode.uid;
        const saveObj = {
            "group": false,
            "type": templetType?.toLowerCase(),
            "msgId": "",
            "remoteJid": finalToJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        };

        const session = await getSession(instance);

        if (templetType === "text" || templetType === "poll" || templetType === "loc") {
            const resp = await sendTextMsg({ uid, msgObj, toJid: finalToJid, saveObj, chatId: finalChatId, session, sessionId: instance });
            res.json(resp);
        } else {
            const resp = await sendMedia({ uid, msgObj, toJid: finalToJid, saveObj, chatId: finalChatId, session, sessionId: instance, sendObj });
            res.json(resp);
        }

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});

module.exports = router;