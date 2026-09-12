require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const nodeCleanup = require('node-cleanup');

// --------------------
// Middlewares y rutas
// --------------------
const { init, cleanup } = require('./middlewares/req.js');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());
app.use(fileUpload());

// Routers
app.use('/api/admin', require('./routes/admin'));
app.use('/api/user', require('./routes/user'));
app.use('/api/web', require('./routes/web'));
app.use('/api/session', require('./routes/session'));
app.use('/api/inbox', require('./routes/inbox'));
app.use('/api/flow', require('./routes/flow'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.use('/api/templet', require('./routes/templet'));
app.use('/api/broadcast', require('./routes/broadcast'));
app.use('/api/plan', require('./routes/plan'));
app.use('/api/v1', require('./routes/api'));

// Servir frontend
app.use(express.static(path.resolve(__dirname, "./client/public")));

app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, "./client/public", "index.html"));
});

// --------------------
// Inicializar servidor
// --------------------
const PORT = process.env.PORT || 3010;
const server = app.listen(PORT, async () => {
    console.log(`WhatsApp server is running on port ${PORT}`);
    // Inicializamos sesiones
    await init();
});

// --------------------
// Socket.IO (si lo usas)
// --------------------
const { initializeSocket } = require('./socket.js');
const io = initializeSocket(server);

// --------------------
// Cleanup al cerrar
// --------------------
nodeCleanup(() => {
    cleanup();
    process.exit();
});

module.exports = io;
