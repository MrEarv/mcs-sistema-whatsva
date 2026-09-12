const { query } = require('../database/dbpromise');
const { getSession, isExists } = require('../middlewares/req');

function mergeObjects(arrayA, arrayB, idKey, passedNameKey) {
    const mergedArray = [];
    for (let objA of arrayA) {
        const matchingObjects = arrayB.filter(obj => obj[idKey] === objA[idKey]);
        if (matchingObjects.length > 0) {
            const mergedObject = { ...objA };
            mergedObject[passedNameKey] = matchingObjects;
            mergedArray.push(mergedObject);
        } else {
            mergedArray.push(objA);
        }
    }
    return mergedArray; // Return the merged array
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomNumberBetween(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}

function getRandomElementFromArray(array, exclude) {
    const filteredArray = array.filter(item => item !== exclude);
    const randomIndex = Math.floor(Math.random() * filteredArray.length);
    return filteredArray[randomIndex];
}

async function sendTyping(session, jid) {
    session.sendPresenceUpdate('composing', jid)
    setTimeout(() => {
        session.sendPresenceUpdate('paused', jid)
    }, getRandomNumberBetween(1000, 3000));
}

async function getWarmerFromDB() {
    const warmer = await query(`SELECT * FROM warmers WHERE is_active = ?`, [1])
    const warmerScript = await query(`SELECT * FROM warmer_script`, [])

    const result = mergeObjects(warmer, warmerScript, 'uid', 'script')
    return result
}

async function checkPlanAndAction(uid) {
    try {
        const user = await query(`SELECT * FROM user WHERE uid = ?`, [uid])
        if (user?.length < 1) {
            await query(`UPDATE warmers SET is_active = ? WHERE uid = ?`, [0, uid])
            console.log("User found found so turned warmer stop")
            return false
        } else {
            const plan = user[0]?.plan ? JSON.parse(user[0]?.plan) : {}
            if (parseInt(plan?.wa_warmer) > 0) {
                return true
            } else {
                console.log("warmer nout found in the plan so turned off")
                await query(`UPDATE warmers SET is_active = ? WHERE uid = ?`, [0, uid])
                return false
            }
        }
    } catch (err) {
        console.log("ERROR FOUND IN checkPlanAndAction", err)
    }
}

async function runWarmer(warmer) {
    try {

        const instanceArr = JSON.parse(warmer?.instances)
        const scriptArr = warmer?.script
        if (instanceArr.length > 1) {

            await checkPlanAndAction(warmer?.uid)

            const instanceFrom = getRandomElementFromArray(instanceArr)
            const script = getRandomElementFromArray(scriptArr)
            const instanceTo = getRandomElementFromArray(instanceArr, instanceFrom)

            // getting to instance from db 
            const instanceToObj = await query(`SELECT * FROM instance WHERE instance_id = ?`, [instanceTo])

            // getting session 
            const session = await getSession(instanceFrom)
            if (session && instanceToObj?.length > 0) {
                console.log({
                    instanceToObj
                })
                const exist = await isExists(session, instanceToObj[0]?.jid, false)
                if (exist) {
                    const to = `${instanceToObj[0]?.jid}@s.whatsapp.net`
                    const msg = {
                        text: script?.message
                    }

                    console.log({
                        to
                    })

                    await sendTyping(session, instanceToObj[0]?.jid)
                    await session.sendMessage(to, msg)

                } else {
                    console.log(`Jid ${instanceToObj[0]?.jid} does not exist`)
                }

            } else {
                console.log("session not found so turned off", instanceFrom)
                // await query(`UPDATE warmers SET is_active = ? WHERE uid = ?`, [0, warmer?.uid])
                console.log(`seesion not found ${instanceFrom}`)
            }
        }

    } catch (err) {
        console.log(`Error found in in runWarmer`, err)
    }
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

async function warmerLoopInit() {
    try {
        const warmers = await getWarmerFromDB()
        if (warmers.length > 0) {
            const promises = warmers.map((warmer) => runWarmer(warmer));
            await Promise.all(promises);
        }

        await delay(2000)
        warmerLoopInit()
    } catch (err) {
        console.log(err)
    }
}

module.exports = { warmerLoopInit }