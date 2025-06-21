require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// بيانات مخزنة مؤقتاً في الذاكرة
const usersData = [];
const adminMessages = [];
const bookingsData = [];
const resultsData = [];

// إعداد multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'public/uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));
app.use(express.static(path.join(__dirname, 'public')));

// حماية الراوتات
function checkAuth(req, res, next) {
  if (req.session && req.session.isLoggedIn) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// إعداد nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// استقبال بيانات المستخدم
app.post('/api/submit', (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  usersData.push({ name, email, phone, receivedAt: new Date() });
  res.json({ message: 'تم استلام البيانات بنجاح' });
});

// استقبال بيانات الحجز
app.post('/api/booking', (req, res) => {
  const { name, phone, date, time } = req.body;
  if (!name || !phone || !date || !time) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  bookingsData.push({ name, phone, date, time, receivedAt: new Date() });

  if (process.env.ADMIN_EMAIL) {
    transporter.sendMail({
      from: `"Bedaya System" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: 'حجز جديد في نظام بداية',
      html: `
        <h2>تم استقبال حجز جديد</h2>
        <p><strong>الاسم:</strong> ${name}</p>
        <p><strong>رقم الهاتف:</strong> ${phone}</p>
        <p><strong>التاريخ:</strong> ${date}</p>
        <p><strong>الوقت:</strong> ${time}</p>
        <p>تاريخ الاستلام: ${new Date().toLocaleString('ar-EG')}</p>
      `
    }).catch(console.error);
  }

  res.json({ message: 'تم استلام الحجز بنجاح' });
});

// رفع النتائج
app.post('/api/upload-result', upload.single('resultFile'), (req, res) => {
  const { phone } = req.body;
  if (!phone || !req.file) {
    return res.status(400).json({ error: 'رقم الهاتف والملف مطلوبان' });
  }

  const fileUrl = '/uploads/' + req.file.filename;
  resultsData.push({ phone, fileUrl, uploadedAt: new Date() });
  res.json({ message: 'تم رفع النتيجة بنجاح', fileUrl });
});

// البحث عن النتائج
app.get('/api/results/:phone', (req, res) => {
  const phone = req.params.phone;
  const result = resultsData.find(r => r.phone === phone);
  if (result) {
    res.json({ success: true, result });
  } else {
    res.status(404).json({ success: false, message: 'لا توجد نتائج لهذا الرقم' });
  }
});

// تسجيل دخول الادمن
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.isLoggedIn = true;
    res.json({ message: 'تم تسجيل الدخول بنجاح' });
  } else {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
});

// تسجيل خروج الادمن
app.post('/api/admin/logout', checkAuth, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الخروج' });
    res.json({ message: 'تم تسجيل الخروج بنجاح' });
  });
});

// جلب بيانات المستخدمين
app.get('/api/admin/users', checkAuth, (req, res) => {
  const usersWithMessages = usersData.map(user => {
    const userMessages = adminMessages.filter(msg => msg.email === user.email);
    return {
      ...user,
      messages: userMessages.map(msg => msg.message).join('\n\n') || 'لا توجد رسائل'
    };
  });
  res.json(usersWithMessages);
});

// جلب بيانات الحجوزات
app.get('/api/admin/bookings', checkAuth, (req, res) => {
  res.json(bookingsData);
});

// جلب بيانات النتائج
app.get('/api/admin/results', checkAuth, (req, res) => {
  res.json(resultsData);
});

// حذف مستخدم
app.delete('/api/admin/user/:email', checkAuth, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const index = usersData.findIndex(user => user.email === email);
  if (index === -1) {
    return res.status(404).json({ error: 'المستخدم غير موجود' });
  }
  usersData.splice(index, 1);
  res.json({ message: `تم حذف المستخدم ${email} بنجاح` });
});

// حذف حجز
app.delete('/api/admin/booking/:phone', checkAuth, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const index = bookingsData.findIndex(b => b.phone === phone);
  if (index === -1) {
    return res.status(404).json({ error: 'الحجز غير موجود' });
  }
  bookingsData.splice(index, 1);
  res.json({ message: `تم حذف الحجز لرقم ${phone} بنجاح` });
});

// حذف نتيجة
app.delete('/api/admin/result/:phone', checkAuth, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const index = resultsData.findIndex(r => r.phone === phone);
  if (index === -1) {
    return res.status(404).json({ error: 'النتيجة غير موجودة' });
  }

  const filePath = path.join(__dirname, 'public', resultsData[index].fileUrl);
  fs.unlink(filePath, (err) => {
    if (err) console.error('Error deleting file:', err);
  });

  resultsData.splice(index, 1);
  res.json({ message: `تم حذف النتيجة لرقم ${phone} بنجاح` });
});

// إرسال رسالة
app.post('/api/admin/message', checkAuth, async (req, res) => {
  const { email, message } = req.body;
  if (!email || !message || message.trim() === "") {
    return res.status(400).json({ error: 'البريد الإلكتروني والرسالة مطلوبين' });
  }

  try {
    await transporter.sendMail({
      from: `"Bedaya" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'مركز Bedaya',
      text: message,
      html: `<p>${message}</p>`
    });

    adminMessages.push({ 
      email, 
      message,
      sentAt: new Date() 
    });
    res.json({ message: 'تم إرسال الرسالة بنجاح' });
  } catch (err) {
    console.error('خطأ في إرسال الإيميل:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال الإيميل' });
  }
});

// جلب الرسائل
app.get('/api/admin/messages', checkAuth, (req, res) => {
  res.json(adminMessages);
});

// حذف رسالة
app.delete('/api/admin/message/:index', checkAuth, (req, res) => {
  const index = parseInt(req.params.index);
  if (isNaN(index)) {
    return res.status(400).json({ error: 'معرف الرسالة غير صالح' });
  }
  if (index < 0 || index >= adminMessages.length) {
    return res.status(404).json({ error: 'الرسالة غير موجودة' });
  }

  adminMessages.splice(index, 1);
  res.json({ message: 'تم حذف الرسالة بنجاح' });
});

// صفحة الادمن
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
