const { query } = require('../database/dbpromise');
const { decodeObject, mergeVariables } = require('../functions/function');
const { getSession, isExists } = require('../middlewares/req');
const moment = require('moment-timezone')

function getRandomElementFromArray(array, exclude) {
    const filteredArray = array.filter(item => item !== exclude);
    const randomIndex = Math.floor(Math.random() * filteredArray.length);
    return filteredArray[randomIndex];
}

function hasDatePassedInTimezone(timezone, datetimeFromMySQL) {
    if (!timezone || !datetimeFromMySQL) {
        return true;
    }

    const momentDate = moment.utc(datetimeFromMySQL).tz(timezone);

    if (!momentDate.isValid()) {
        return false;
    }
    const currentMoment = moment.tz(timezone);
    if (!currentMoment.isValid()) {
        return false;
    }
    return momentDate.isBefore(currentMoment);
}

function delayRandom(fromSeconds, toSeconds) {
    const randomSeconds = Math.random() * (toSeconds - fromSeconds) + fromSeconds;

    console.log(`random Delay ${randomSeconds} sec`)

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, randomSeconds * 1000);
    });
}

function resolveTemplet(templet) {
    const type = templet?.type
    const content = JSON.parse(templet?.content)
    switch (type) {
        case 'text':
            return content
        case 'image':
            return {
                image: {
                    url: `${__dirname}/../client/public/media/${content?.image?.url}`
                },
                caption: content?.caption || null,
            }
        case 'doc':
            return {
                document:
                    { url: `${__dirname}/../client/public/media/${content?.document?.url}` },
                fileName: content?.fileName,
                caption: content?.caption || null,
            }
        case 'aud':
            return {
                audio:
                    { url: `${__dirname}/../client/public/media/${content?.audio?.url}` },
                fileName: content?.fileName,
                ptt: true,
            }
        case 'video':
            return {
                video:
                    { url: `${__dirname}/../client/public/media/${content?.video?.url}` },
                caption: content?.caption
            }
        case 'loc':
            return {
                location:
                {
                    degreesLatitude: content?.location?.degreesLatitude,
                    degreesLongitude: content?.location?.degreesLongitude
                }
            }
        case 'poll':
            return content
        default:
            return null;
    }
}

async function getBroadLog() {
    const beforeRes = await query(`SELECT * FROM broadcast WHERE status = ?`, ["PENDING"])

    const res = beforeRes.filter((i) => i.schedule && hasDatePassedInTimezone(i?.timezone, i?.schedule))

    // getting broadcast log 
    if (res.length > 0) {
        const promise = res.map(async (i) => {
            const logOne = await query(`SELECT * FROM broadcast_log WHERE broadcast_id = ? AND delivery_status = ? LIMIT 1`, [
                i?.broadcast_id,
                "PENDING"
            ])


            if (logOne.length < 1) {
                console.log("ZERO")
                await query(`UPDATE broadcast SET status = ? WHERE broadcast_id = ?`, [
                    "COMPLETED",
                    i?.broadcast_id,
                ])
            }
            return {
                success: logOne.length > 0 ? true : false,
                log: logOne[0],
                i: i
            }
        })

        const promiseWait = await Promise.all(promise)
        const finalLog = promiseWait.filter(i => i?.success)

        return finalLog
    } else {
        return []
    }
}

async function sendMessage(logs) {
    const promise = logs.map(async (log) => {
        try {
            const i = log?.i
            const logObj = log?.log

            const insArr = JSON.parse(i?.instance_id)
            const instanceId = getRandomElementFromArray(insArr)
            const boradCastId = logObj?.id
            const jid = `${logObj?.send_to}@s.whatsapp.net`
            const templet = JSON.parse(log?.i?.templet)

            const session = await getSession(instanceId)

            const actualObj = resolveTemplet(templet)


            if (!session) {
                await query(`UPDATE broadcast_log SET delivery_status = ? WHERE id = ?`, [
                    "Instance NA",
                    boradCastId
                ])
            } else {
                // check if number is available 
                const check = await isExists(session, jid, false)
                if (!check) {
                    await query(`UPDATE broadcast_log SET delivery_status = ? WHERE id = ?`, [
                        "Number NA",
                        boradCastId
                    ])
                } else {

                    if (actualObj) {

                        // adding variables 
                        const returnObjWithVariables = mergeVariables({
                            content: actualObj,
                            varJson: JSON.parse(logObj?.contact),
                            type: templet?.type?.toLowerCase()
                        })

                        const send = await session.sendMessage(jid, returnObjWithVariables)
                        if (send?.key?.id) {

                            const { client_id } = decodeObject(instanceId)

                            await query(`UPDATE broadcast_log SET delivery_status = ?, msg_id = ?, instance_id = ? WHERE id = ?`, [
                                "sent",
                                send?.key?.id,
                                client_id,
                                boradCastId
                            ])

                        } else {
                            await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE broadcast_id = ?`, [
                                "failed",
                                send.toString(),
                                boradCastId
                            ])
                        }
                    }
                }
            }

        } catch (err) {
            await query(`UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE broadcast_id = ?`, [
                "failed",
                err.toString(),
                log?.log?.broadcast_id
            ])
        }
    })
    await Promise.all(promise)
}

const DELAYFROM = 10
const DELAYTO = 35

async function broadcastLoopInit() {
    try {

        const logs = await getBroadLog()

        if (logs && logs.length > 0) {
            await sendMessage(logs)
        } else {
            console.log('no broadcast found')
        }

        await delayRandom(DELAYFROM, DELAYTO)

        await broadcastLoopInit()
    } catch (err) {
        console.log(err)
    }
}

module.exports = { broadcastLoopInit }