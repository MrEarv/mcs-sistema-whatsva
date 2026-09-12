require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const { initializeSocket } = require('./socket.js');
const path = require('path');
const { init, cleanup } = require('./middlewares/req.js');
const nodeCleanup = require('node-cleanup');

// Configuración de CORS 
app.use(cors({
    origin: '*',  // Permitir todas las solicitudes
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));


app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(fileUpload());

//Permite guardar las imagenes
app.use('/media', express.static(path.resolve(__dirname, "./client/public/media")));

// Definición de rutas
const adminRoute = require('./routes/admin');
app.use('/api/admin', adminRoute);

const userRoute = require('./routes/user');
app.use('/api/user', userRoute);

const webRoute = require('./routes/web');
app.use('/api/web', webRoute);

const sessionRoute = require('./routes/session');
app.use('/api/session', sessionRoute);

const inboxRoute = require('./routes/inbox');
app.use('/api/inbox', inboxRoute);

const flowRoute = require('./routes/flow');
app.use('/api/flow', flowRoute);

const chatbotRoute = require('./routes/chatbot');
app.use('/api/chatbot', chatbotRoute);

const templetRoute = require('./routes/templet');
app.use('/api/templet', templetRoute);

const broadcastRoute = require('./routes/broadcast');
app.use('/api/broadcast', broadcastRoute);

const planRoute = require('./routes/plan');
app.use('/api/plan', planRoute);

const apiRoute = require('./routes/api');
const { warmerLoopInit } = require('./loops/warmerLoop.js');
const { broadcastLoopInit } = require('./loops/broadcastLoop.js');
app.use('/api/v1', apiRoute);

// Servir archivos estáticos para el frontend desde "client/public"
app.use(express.static(path.resolve(__dirname, "./client/public")));

// Ruta catch-all para el frontend
app.get("*", function (request, response) {
    response.sendFile(path.resolve(__dirname, "./client/public", "index.html"));
});

const server = app.listen(process.env.PORT || 8022, () => {
    init();
    setTimeout(() => {
        warmerLoopInit();
        broadcastLoopInit();
    }, 2000);
    console.log(`Whatsham server is running on port ${process.env.PORT || 8022}`);
});

const io = initializeSocket(server, {
    cors: {
        origin: "http://localhost:8022",  // socket  desde localhost
        methods: ["GET", "POST"],
        credentials: true  // Permite el uso de credenciales 
    }
});

module.exports = io;

// Limpieza de procesos cuando se cierra la aplicación
nodeCleanup(cleanup);