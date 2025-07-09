const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  Browsers
} = require('baileys');
require("./settings")
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const util = require('util');
const axios = require('axios');
const { File } = require('megajs');

const app = express();
const port = process.env.PORT || 3000;

const codes = {};
const User = require('./models/User'); 

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

//===================SESSION-AUTH============================
if (!fs.existsSync(__dirname + '/auth_info_baileys/creds.json')) {
  if (!id) {
    console.log('❌ Please add your session to settings.js !!');
    process.exit(1);
  }

  const filer = File.fromURL(`https://mega.nz/file/${SESSION_ID}`);
  filer.download((err, data) => {
    if (err) throw err;
    fs.writeFileSync(__dirname + '/auth_info_baileys/creds.json', data);
    console.log("✅ Session ID file downloaded");
  });
}

//================ CONNECT TO WHATSAPP =======================
async function connectToWA() {
  console.log("⏳ Connecting Bot To WhatsApp...");
  const { state, saveCreds } = await useMultiFileAuthState(__dirname + '/auth_info_baileys/');
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    logger: P({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS("Firefox"),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 60000,
      fireInitQueries: true,
      msgRetryCounterCache: new Map(),
      auth: state,
      version
  });

  conn.ev.on('creds.update', saveCreds);

  conn.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWA();
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp Connected');

      try {
        await mongoose.connect('mongodb+srv://empirebot:DUCa79mon2mhulS5@atlascluster.huzt8kz.mongodb.net/?retryWrites=true&w=majority&appName=AtlasCluster', {
          useNewUrlParser: true,
          useUnifiedTopology: true
        });
        console.log('🟢 MongoDB Connected');
      } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
        process.exit(1);
      }

      // Routes
      app.post('/signup', async (req, res) => {
        const { name, email, username, password, phone } = req.body;
        if (!name || !email || !username || !password || !phone) {
          return res.json({ success: false, message: 'All fields are required' });
        }

        const existing = await User.findOne({ $or: [{ email }, { username }, { phone }] });
        if (existing) {
          return res.json({ success: false, message: 'User already exists' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000);
        codes[phone] = otp;

        const newUser = new User({ name, email, username, password, phone });
        await newUser.save();

        try {
          const jid = `${phone}@s.whatsapp.net`;
          await conn.sendMessage(jid, { text: `Dear ${name}, your One-Time Password (OTP) for verification is ${otp}. Please use this to complete your action.` });
          res.json({ success: true, message: 'OTP sent via WhatsApp' });
        } catch (err) {
          console.error('❌ WhatsApp send error:', err.message);
          res.json({ success: false, message: 'Failed to send WhatsApp OTP' });
        }
      });

      app.post('/verify', async (req, res) => {
        const { phone, code } = req.body;

        if (codes[phone] && codes[phone] == code) {
          await User.findOneAndUpdate({ phone }, { verified: true });
          delete codes[phone];
          return res.json({ success: true, message: 'Account verified!' });
        }

        res.json({ success: false, message: 'Invalid OTP' });
      });

      app.post('/login', async (req, res) => {
        const { username, password } = req.body;

        const user = await User.findOne({ username, password, verified: true });
        if (!user) {
          return res.json({ success: false, message: 'Invalid credentials or unverified account' });
        }

        res.json({ success: true, message: 'Login successful', user });
      });

      app.listen(port, () => {
        console.log(`🚀 Server running on port ${port}`);
      });
    }
  });
}

connectToWA();
