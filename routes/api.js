const router = require('express').Router()
const { query } = require('../database/dbpromise.js')
const bcrypt = require('bcrypt')
const { sign } = require('jsonwebtoken')
const validateUser = require('../middlewares/user.js')
const moment = require('moment')
const randomstring = require('randomstring')
const { getSession, isExists, } = require('../middlewares/req.js')
const csv = require('csv-parser');
const mime = require('mime-types')
const { decodeToken, encodeChatId, readJSONFile } = require('../functions/function.js');
const { sendTextMsg, sendMedia, send } = require('../functions/x.js');
const { checkPlanExpiry, checkForAPIAccess } = require('../middlewares/planValidator.js')

const validateUserApi = async (req, res, next) => {
    try {
        const token = req.query?.token
        if (!token) {
            res.json({
                msg: "Please add token"
            })
        }
        const user = await decodeToken(token)

        if (!user.success) {
            return res.json({ ...user, token })
        }

        req.decode = user?.decode
        req.user = user?.user

        next()

    } catch (err) {
        res.json({ err, msg: "something went wrong" })
        console.log(err)
    }
}

// sending msg 
router.get('/send-text', validateUserApi, checkPlanExpiry, async (req, res) => {
    try {
        const { token, instance_id, msg, jid } = req.query;

        if (!token || !instance_id || !msg || !jid) {
            return res.json({ success: false, message: "Parameter [token, instance_id, msg, jid] are required!" });
        }

        const session = await getSession(instance_id);
        if (!session) {
            return res.json({ success: false, message: "Either your instance_id is invalid or your instance is not longer connected" });
        }

        const finalToJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;

        const last10 = finalToJid.replace(/\D/g, '').slice(-10);
        const getChat = await query(`SELECT chat_id FROM chats WHERE uid = ? AND instance_id = ? AND (sender_jid LIKE ? OR sender_mobile LIKE ?) LIMIT 1`, [req.decode.uid, instance_id, `%${last10}%`, `%${last10}%`]);
        
        const chatId = getChat.length > 0 ? getChat[0].chat_id : encodeChatId({ ins: instance_id, grp: finalToJid.includes('@g.us'), num: finalToJid.replace('@s.whatsapp.net', '') });

        const msgObj = { text: msg };
        const saveObj = {
            group: finalToJid.includes('@g.us'),
            type: "text",
            msgId: "",
            remoteJid: finalToJid,
            msgContext: msgObj,
            reaction: "",
            timestamp: "",
            senderName: "Sistema API", // Para identificar que se mandó desde afuera
            status: "sent",
            star: false,
            route: "outgoing",
            context: ""
        };

        const resp = await sendTextMsg({
            uid: req.decode.uid,
            msgObj,
            toJid: finalToJid,
            saveObj,
            chatId: chatId,
            session,
            sessionId: instance_id
        });

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: resp
        });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});


// sendig image  
router.get('/send-image', validateUserApi, checkPlanExpiry, async (req, res) => {
    try {
        const { token, instance_id, caption, jid, imageurl } = req.query;

        if (!token || !instance_id || !jid || !imageurl) {
            return res.json({ success: false, message: "Parameter [token, instance_id, jid, imageurl] are required!" });
        }

        const session = await getSession(instance_id);
        if (!session) {
            return res.json({ success: false, message: "Either your instance_id is invalid or your instance is not longer connected" });
        }

        const finalToJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
        const last10 = finalToJid.replace(/\D/g, '').slice(-10);
        const getChat = await query(`SELECT chat_id FROM chats WHERE uid = ? AND instance_id = ? AND (sender_jid LIKE ? OR sender_mobile LIKE ?) LIMIT 1`, [req.decode.uid, instance_id, `%${last10}%`, `%${last10}%`]);
        const chatId = getChat.length > 0 ? getChat[0].chat_id : encodeChatId({ ins: instance_id, grp: finalToJid.includes('@g.us'), num: finalToJid.replace('@s.whatsapp.net', '') });

        const sendObj = {
            image: { url: imageurl },
            caption: caption || ""
        };

        const msgObj = {
            caption: caption || "",
            fileName: imageurl,
            mimetype: "image/jpeg"
        };

        const saveObj = {
            group: finalToJid.includes('@g.us'),
            type: "image",
            msgId: "",
            remoteJid: finalToJid,
            msgContext: msgObj,
            reaction: "",
            timestamp: "",
            senderName: "Sistema API",
            status: "sent",
            star: false,
            route: "outgoing",
            context: ""
        };

        const resp = await sendMedia({
            uid: req.decode.uid,
            msgObj,
            toJid: finalToJid,
            saveObj,
            chatId: chatId,
            session,
            sessionId: instance_id,
            sendObj
        });

        res.json({ success: true, message: "Message sent successfully!", response: resp });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});

// sendig video  
router.get('/send-video', validateUserApi, checkPlanExpiry, async (req, res) => {
    try {
        const { token, instance_id, caption, jid, videourl } = req.query;

        if (!token || !instance_id || !jid || !videourl) {
            return res.json({ success: false, message: "Parameter [token, instance_id, jid, videourl] are required!" });
        }

        const session = await getSession(instance_id);
        if (!session) {
            return res.json({ success: false, message: "Either your instance_id is invalid or your instance is not longer connected" });
        }

        const finalToJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
        const last10 = finalToJid.replace(/\D/g, '').slice(-10);
        const getChat = await query(`SELECT chat_id FROM chats WHERE uid = ? AND instance_id = ? AND (sender_jid LIKE ? OR sender_mobile LIKE ?) LIMIT 1`, [req.decode.uid, instance_id, `%${last10}%`, `%${last10}%`]);
        const chatId = getChat.length > 0 ? getChat[0].chat_id : encodeChatId({ ins: instance_id, grp: finalToJid.includes('@g.us'), num: finalToJid.replace('@s.whatsapp.net', '') });

        const sendObj = {
            video: { url: videourl },
            caption: caption || ""
        };

        const msgObj = {
            caption: caption || "",
            fileName: videourl,
            mimetype: "video/mp4"
        };

        const saveObj = {
            group: finalToJid.includes('@g.us'),
            type: "video",
            msgId: "",
            remoteJid: finalToJid,
            msgContext: msgObj,
            reaction: "",
            timestamp: "",
            senderName: "Sistema API",
            status: "sent",
            star: false,
            route: "outgoing",
            context: ""
        };

        const resp = await sendMedia({
            uid: req.decode.uid,
            msgObj,
            toJid: finalToJid,
            saveObj,
            chatId: chatId,
            session,
            sessionId: instance_id,
            sendObj
        });

        res.json({ success: true, message: "Message sent successfully!", response: resp });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});
// Enviar audio via API
router.get('/send-audio', validateUserApi, checkPlanExpiry, async (req, res) => {
    try {
        const { token, instance_id, jid, audiourl } = req.query;

        if (!token || !instance_id || !jid || !audiourl) {
            return res.json({
                success: false,
                message: "Parameter [token, instance_id, jid, audiourl] are required!"
            });
        }

        const session = await getSession(instance_id);
        if (!session) {
            return res.json({
                success: false,
                message: "Either your instance_id is invalid or your instance is not longer connected"
            });
        }

        const finalToJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
        const last10 = finalToJid.replace(/\D/g, '').slice(-10);
        const getChat = await query(`SELECT chat_id FROM chats WHERE uid = ? AND instance_id = ? AND (sender_jid LIKE ? OR sender_mobile LIKE ?) LIMIT 1`, [req.decode.uid, instance_id, `%${last10}%`, `%${last10}%`]);
        const chatId = getChat.length > 0 ? getChat[0].chat_id : encodeChatId({ ins: instance_id, grp: finalToJid.includes('@g.us'), num: finalToJid.replace('@s.whatsapp.net', '') });

        const sendObj = {
            audio: { url: audiourl },
            ptt: true
        };

        const msgObj = {
            caption: "",
            fileName: audiourl,
            mimetype: "audio/ogg"
        };

        const saveObj = {
            group: finalToJid.includes('@g.us'),
            type: "aud",
            msgId: "",
            remoteJid: finalToJid,
            msgContext: msgObj,
            reaction: "",
            timestamp: "",
            senderName: "Sistema API",
            status: "sent",
            star: false,
            route: "outgoing",
            context: ""
        };

        const resp = await sendMedia({
            uid: req.decode.uid,
            msgObj,
            toJid: finalToJid,
            saveObj,
            chatId: chatId,
            session,
            sessionId: instance_id,
            sendObj
        });

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: resp
        });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});

// Enviar documento via API
router.get('/send-doc', validateUserApi, checkPlanExpiry, async (req, res) => {
    try {
        const { token, instance_id, jid, docurl, caption } = req.query;

        if (!token || !instance_id || !jid || !docurl || !caption) {
            return res.json({
                success: false,
                message: "Parameter [token, instance_id, jid, docurl, caption] are required!"
            });
        }

        const session = await getSession(instance_id);
        if (!session) {
            return res.json({
                success: false,
                message: "Either your instance_id is invalid or your instance is not longer connected"
            });
        }

        const finalToJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
        const last10 = finalToJid.replace(/\D/g, '').slice(-10);
        const getChat = await query(`SELECT chat_id FROM chats WHERE uid = ? AND instance_id = ? AND (sender_jid LIKE ? OR sender_mobile LIKE ?) LIMIT 1`, [req.decode.uid, instance_id, `%${last10}%`, `%${last10}%`]);
        const chatId = getChat.length > 0 ? getChat[0].chat_id : encodeChatId({ ins: instance_id, grp: finalToJid.includes('@g.us'), num: finalToJid.replace('@s.whatsapp.net', '') });

        const sendObj = {
            document: { url: docurl },
            caption: caption || ""
        };

        const msgObj = {
            caption: caption || "",
            fileName: docurl,
            mimetype: "application/pdf"
        };

        const saveObj = {
            group: finalToJid.includes('@g.us'),
            type: "doc",
            msgId: "",
            remoteJid: finalToJid,
            msgContext: msgObj,
            reaction: "",
            timestamp: "",
            senderName: "Sistema API",
            status: "sent",
            star: false,
            route: "outgoing",
            context: ""
        };

        const resp = await sendMedia({
            uid: req.decode.uid,
            msgObj,
            toJid: finalToJid,
            saveObj,
            chatId: chatId,
            session,
            sessionId: instance_id,
            sendObj
        });

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: resp
        });

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err });
        console.log(err);
    }
});
// Obtener la lista de chats de una instancia
router.get('/get-chats', validateUserApi, checkPlanExpiry, checkForAPIAccess, async (req, res) => {
    try {
        const { token, instance_id } = req.query;

        if (!token || !instance_id) {
            return res.json({ success: false, message: "Parameters [token, instance_id] are required!" });
        }

        // Consultamos la BD trayendo los datos esenciales del chat, ordenados por el más reciente
        const data = await query(`
            SELECT chat_id, sender_name, sender_mobile, sender_jid, last_message_came, is_opened, chat_status 
            FROM chats 
            WHERE uid = ? AND instance_id = ? 
            ORDER BY last_message_came DESC
        `, [req.decode.uid, instance_id]);

        res.json({ success: true, data });

    } catch (err) {
        console.log(err);
        res.json({ success: false, msg: "something went wrong", err });
    }
});

// Obtener el historial de mensajes de un chat específico
router.get('/get-messages', validateUserApi, checkPlanExpiry, checkForAPIAccess, async (req, res) => {
    try {
        const { token, instance_id, chat_id } = req.query;

        if (!token || !instance_id || !chat_id) {
            return res.json({ success: false, message: "Parameters [token, instance_id, chat_id] are required!" });
        }

        const filePath = `${__dirname}/../conversations/inbox/${req.decode.uid}/${chat_id}.json`;
        
        // Leemos los últimos 100 mensajes del historial JSON de ese chat
        const data = readJSONFile(filePath, 100); 

        res.json({ success: true, data });

    } catch (err) {
        console.log(err);
        res.json({ success: false, msg: "something went wrong", err });
    }
});
module.exports = router