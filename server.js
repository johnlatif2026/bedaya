require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

// Firebase Setup (استخدم متغيرات البيئة الخاصة بك)
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// إعداد البريد الإلكتروني بشكل احترافي
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// تخزين الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

// Middleware Auth
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  jwt.verify(token, process.env.SESSION_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

// Routes 
app.post('/api/booking', async (req, res) => {
  const { name, phone, date, time } = req.body;
  await db.collection('bookings').add({ name, phone, date, time, receivedAt: new Date() });
  // إرسال إيميل للمسؤول بشكل جميل
  await transporter.sendMail({
    from: `"بداية" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: '📅 حجز جديد في مركز بداية',
    html: `<div dir="rtl"><h2>موعد جديد</h2><p>الاسم: ${name}</p><p>الهاتف: ${phone}</p><p>التاريخ: ${date} الساعة: ${time}</p><img src="https://i.postimg.cc/PqYGJKTd/Logo.jpg" width="50"/></div>`
  });
  res.json({ message: 'تم الحجز بنجاح' });
});

app.post('/api/message', async (req, res) => {
  const { name, email, message, phone } = req.body;
  await transporter.sendMail({
    from: `"رسالة من بداية" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `📩 رسالة جديدة من ${name}`,
    html: `<div style="font-family: Arial; direction: rtl;"><h3>📌 تفاصيل المرسل</h3><p><strong>الاسم:</strong> ${name}</p><p><strong>البريد:</strong> ${email}</p><p><strong>الجوال:</strong> ${phone}</p><hr/><p><strong>الرسالة:</strong><br/>${message}</p><br/><img src="https://i.postimg.cc/PqYGJKTd/Logo.jpg" width="60"/></div>`
  });
  await db.collection('adminMessages').add({ email, message, name, phone, sentAt: new Date() });
  res.json({ message: 'تم الإرسال' });
});

app.post('/api/upload-result', upload.single('resultFile'), auth, async (req, res) => {
  const { phone } = req.body;
  const fileUrl = '/uploads/' + req.file.filename;
  await db.collection('results').add({ phone, fileUrl, uploadedAt: new Date() });
  res.json({ message: 'رفع النتيجة بنجاح' });
});

app.get('/api/results/:phone', async (req, res) => {
  const snap = await db.collection('results').where('phone', '==', req.params.phone).get();
  const results = snap.docs.map(d => d.data());
  results.length ? res.json({ success: true, results }) : res.status(404).json({ success: false, message: 'لا يوجد' });
});

// Admin endpoints (مختصرة لكن كاملة)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ username }, process.env.SESSION_SECRET, { expiresIn: '8h' });
    res.json({ token });
  } else res.status(401).json({ error: 'خطأ' });
});

app.get('/api/admin/users', auth, async (req, res) => {
  const usersSnap = await db.collection('users').get();
  const messagesSnap = await db.collection('adminMessages').get();
  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data(), messages: messagesSnap.docs.filter(m => m.data().email === d.data().email).map(m => m.data().message).join('\n') }));
  res.json(users);
});

app.get('/api/admin/bookings', auth, async (req, res) => {
  const snap = await db.collection('bookings').get();
  res.json(snap.docs.map(d => d.data()));
});

app.get('/api/admin/results', auth, async (req, res) => {
  const snap = await db.collection('results').get();
  res.json(snap.docs.map(d => d.data()));
});

// إدارة المبيعات
app.post('/api/admin/sales', auth, async (req, res) => {
  const { customerName, amount } = req.body;
  const sale = { id: Date.now().toString(), customerName, amount: parseFloat(amount), saleTime: new Date().toISOString() };
  await db.collection('sales').doc(sale.id).set(sale);
  res.json(sale);
});

app.get('/api/admin/sales/today', auth, async (req, res) => {
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const snap = await db.collection('sales').where('saleTime', '>=', todayStart.toISOString()).get();
  const sales = snap.docs.map(d => d.data());
  const total = sales.reduce((s, i) => s + i.amount, 0);
  res.json({ sales, todayTotal: total });
});

app.delete('/api/admin/sale/:id', auth, async (req, res) => {
  await db.collection('sales').doc(req.params.id).delete();
  res.json({ message: 'deleted' });
});
app.delete('/api/admin/user/:email', auth, async (req, res) => {
  const snap = await db.collection('users').where('email', '==', decodeURIComponent(req.params.email)).get();
  snap.forEach(d => d.ref.delete());
  res.json({});
});
app.delete('/api/admin/booking/:phone', auth, async (req, res) => {
  const snap = await db.collection('bookings').where('phone', '==', decodeURIComponent(req.params.phone)).get();
  snap.forEach(d => d.ref.delete());
  res.json({});
});
app.delete('/api/admin/result/:phone', auth, async (req, res) => {
  const snap = await db.collection('results').where('phone', '==', decodeURIComponent(req.params.phone)).get();
  snap.forEach(d => d.ref.delete());
  res.json({});
});
app.post('/api/admin/message', auth, async (req, res) => {
  const { email, message } = req.body;
  await transporter.sendMail({ from: `"إدارة بداية" <${process.env.SMTP_USER}>`, to: email, subject: '📢 رسالة من مركز بداية', html: `<div dir="rtl"><p>${message}</p><br/><img src="https://i.postimg.cc/PqYGJKTd/Logo.jpg" width="50"/></div>` });
  await db.collection('adminMessages').add({ email, message, sentAt: new Date() });
  res.json({ message: 'تم' });
});

app.listen(3000, () => console.log('✅ Server on port 3000'));
