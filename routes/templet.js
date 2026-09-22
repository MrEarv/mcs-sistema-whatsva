const router = require('express').Router()
const { query } = require('../database/dbpromise.js')
const validateUser = require('../middlewares/user.js')
const { checkPlanExpiry } = require('../middlewares/planValidator.js')

// Helper universal para desempacar los datos que manda React
const extractPayload = (req) => req.body?.data?.payload || req.body?.data || req.body;

// adding one 
router.post('/add_new', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const { title, type, content } = payload;

        if (!title || !type || !content) {
            return res.json({
                success: false,
                msg: "Title is required"
            })
        }

        await query(`INSERT INTO templets (uid, content, type, title) VALUES (?,?,?,?)`, [
            req.decode.uid,
            JSON.stringify(content),
            type,
            title
        ])

        res.json({
            success: true,
            msg: "Templet was saved"
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// get my templet 
router.get('/my_templet', validateUser, async (req, res) => {
    try {
        const data = await query(`SELECT * FROM templets WHERE uid = ?`, [req.decode.uid])
        res.json({ data, success: true })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// del a templet 
router.post('/del_templet', validateUser, async (req, res) => {
    try {
        const payload = extractPayload(req);
        const { id } = payload;

        await query(`DELETE FROM templets WHERE id = ? AND uid = ?`, [
            id, req.decode.uid
        ])

        res.json({
            msg: "Templet was deleted",
            success: true
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

module.exports = router