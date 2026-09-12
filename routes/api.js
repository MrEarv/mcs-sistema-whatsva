const router = require('express').Router()
const { query } = require('../database/dbpromise.js')
const bcrypt = require('bcrypt')
const { sign } = require('jsonwebtoken')
const validateUser = require('../middlewares/user.js')
const moment = require('moment')
const { decodeToken } = require('../functions/function.js')
const randomstring = require('randomstring')
const { getSession, isExists, } = require('../middlewares/req.js')
const csv = require('csv-parser');
const mime = require('mime-types')
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

// sendig msg 
router.get('/send-text', validateUserApi, checkPlanExpiry, checkForAPIAccess, async (req, res) => {
    try {
        const { token, instance_id, msg, jid } = req.query

        console.log(req.query)

        if (!token || !instance_id || !msg || !jid) {
            return res.json({
                success: false,
                message: "Parameter [token, instance_id, msg, jid] are required!"
            })
        }

        const user = await decodeToken(token)

        if (!user.success) {
            return res.json(user)
        }

        const session = await getSession(instance_id)

        if (!session) {
            return res.json({
                success: false,
                message: "Either your instance_id is invalid or your instance is not longer connected"
            })
        }

        // checking on whatsapp 
        const check = await isExists(session, jid, false)

        console.log({ check })

        if (!check) {
            return res.json({
                success: false,
                message: "This number is not found on WhatsApp"
            })
        }

        // sending message 
        const obj = {
            text: msg
        }

        const send = await session.sendMessage(jid, obj)

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: send
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

function sendMedia(obj, session, jid) {
    return new Promise(async (resolve) => {
        try {

            const send = await session.sendMessage(jid, obj)

            resolve(send)

        } catch (err) {
            resolve(null)
        }
    })
}

// sendig image  
router.get('/send-image', validateUserApi, checkPlanExpiry, checkForAPIAccess, async (req, res) => {
    try {
        const { token, instance_id, caption, jid, imageurl } = req.query

        console.log(req.query)

        if (!token || !instance_id || !caption || !jid || !imageurl) {
            return res.json({
                success: false,
                message: "Parameter [token, instance_id, caption, jid, imageurl] are required!"
            })
        }

        const user = await decodeToken(token)

        if (!user.success) {
            return res.json(user)
        }

        const session = await getSession(instance_id)

        if (!session) {
            return res.json({
                success: false,
                message: "Either your instance_id is invalid or your instance is not longer connected"
            })
        }


        // checking on whatsapp 
        const check = await isExists(session, jid, false)

        console.log({ check })

        if (!check) {
            return res.json({
                success: false,
                message: "This number is not found on WhatsApp"
            })
        }


        // sending message 
        const obj = {
            image: {
                url: imageurl,
            },
            caption: caption
        }

        const send = await sendMedia(obj, session, jid)

        if (!send) {
            return res.json({
                success: false,
                message: "Invalid URL found"
            })
        }

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: send
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// sendig video  
router.get('/send-video', validateUserApi, checkPlanExpiry, checkForAPIAccess, async (req, res) => {
    try {
        const { token, instance_id, caption, jid, videourl } = req.query

        console.log(req.query)

        if (!token || !instance_id || !caption || !jid || !videourl) {
            return res.json({
                success: false,
                message: "Parameter [token, instance_id, caption, jid, videourl] are required!"
            })
        }

        const user = await decodeToken(token)

        if (!user.success) {
            return res.json(user)
        }

        const session = await getSession(instance_id)

        if (!session) {
            return res.json({
                success: false,
                message: "Either your instance_id is invalid or your instance is not longer connected"
            })
        }


        // checking on whatsapp 
        const check = await isExists(session, jid, false)

        if (!check) {
            return res.json({
                success: false,
                message: "This number is not found on WhatsApp"
            })
        }


        // sending message 
        const obj = {
            video: {
                url: videourl,
            },
            caption: caption || null
        }

        const send = await sendMedia(obj, session, jid)

        if (!send) {
            return res.json({
                success: false,
                message: "Invalid URL found"
            })
        }

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: send
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// sendig video  
router.get('/send-audio', validateUserApi, checkPlanExpiry, checkForAPIAccess, async (req, res) => {
    try {
        const { token, instance_id, jid, audiourl } = req.query

        if (!token || !instance_id || !jid || !audiourl) {
            return res.json({
                success: false,
                message: "Parameter [token, instance_id, jid, audiourl] are required!"
            })
        }

        const user = await decodeToken(token)

        if (!user.success) {
            return res.json(user)
        }

        const session = await getSession(instance_id)

        if (!session) {
            return res.json({
                success: false,
                message: "Either your instance_id is invalid or your instance is not longer connected"
            })
        }

        // checking on whatsapp 
        const check = await isExists(session, jid, false)

        if (!check) {
            return res.json({
                success: false,
                message: "This number is not found on WhatsApp"
            })
        }


        // sending message 
        const obj = {
            audio: {
                url: audiourl,
            },
            ptt: true
        }

        const send = await sendMedia(obj, session, jid)

        if (!send) {
            return res.json({
                success: false,
                message: "Invalid URL found"
            })
        }

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: send
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// sendig video  
router.get('/send-doc', validateUserApi, checkPlanExpiry, checkForAPIAccess, async (req, res) => {
    try {

        const { token, instance_id, jid, docurl, caption } = req.query

        console.log(req.query)

        if (!token || !instance_id || !jid || !docurl || !caption) {
            return res.json({
                success: false,
                message: "Parameter [token, instance_id, jid, docurl, caption] are required!"
            })
        }

        const user = await decodeToken(token)

        if (!user.success) {
            return res.json(user)
        }

        const session = await getSession(instance_id)

        if (!session) {
            return res.json({
                success: false,
                message: "Either your instance_id is invalid or your instance is not longer connected"
            })
        }

        // checking on whatsapp 
        const check = await isExists(session, jid, false)

        if (!check) {
            return res.json({
                success: false,
                message: "This number is not found on WhatsApp"
            })
        }


        // sending message 
        const obj = {
            document: {
                url: docurl,
            },
            caption: caption || null
        }

        const send = await sendMedia(obj, session, jid)

        if (!send) {
            return res.json({
                success: false,
                message: "Invalid URL found"
            })
        }

        res.json({
            success: true,
            message: "Message sent successfully!",
            response: send
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

module.exports = router