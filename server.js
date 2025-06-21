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

// بيانات مؤقتة
const usersData = [];
const adminMessages = [];
const bookingsData = [];
const resultsData = [];

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// ممكن تستخدم express.json() بدل bodyParser.json() لكن bodyParser تمام
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));
app.use(express.static(path.join(__dirname, 'public')));

// إعداد ملفات الرفع
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// حماية الراوتات
function checkAuth(req, res, next) {
  if (req.session?.isLoggedIn) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// إعداد البريد الإلكتروني
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// **التعديل الرئيسي: استقبال بيانات المستخدم (POST وليس GET)**
app.post('/api/submit', (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'الرجاء ملء جميع الحقول' });
  }
  usersData.push({ name, email, phone, receivedAt: new Date() });
  res.json({ message: 'تم استلام البيانات بنجاح' });
});

// رسالة عامة
app.post('/api/message', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'الاسم والإيميل والرسالة مطلوبة' });
  }

  try {
    await transporter.sendMail({
      from: `"Bedaya" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL || process.env.SMTP_USER,
      subject: `رسالة من ${name}`,
      html: `
        <h2>رسالة جديدة</h2>
        <p><strong>الاسم:</strong> ${name}</p>
        <p><strong>البريد الإلكتروني:</strong> ${email}</p>
        <p><strong>الرسالة:</strong><br>${message}</p>
      `
    });

adminMessages.push({ email, message, name, phone: req.body.phone || null, sentAt: new Date() });

    res.json({ message: 'تم إرسال الرسالة بنجاح' });
  } catch (err) {
    console.error('خطأ في إرسال الرسالة:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة' });
  }
});

// حجز موعد
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
        <h2>حجز جديد</h2>
        <p><strong>الاسم:</strong> ${name}</p>
        <p><strong>الهاتف:</strong> ${phone}</p>
        <p><strong>التاريخ:</strong> ${date}</p>
        <p><strong>الوقت:</strong> ${time}</p>
        <p>الاستلام: ${new Date().toLocaleString('ar-EG')}</p>
      `
    }).catch(console.error);
  }

  res.json({ message: 'تم استلام الحجز بنجاح' });
});

// رفع نتيجة
app.post('/api/upload-result', upload.single('resultFile'), (req, res) => {
  const { phone } = req.body;
  if (!phone || !req.file) {
    return res.status(400).json({ error: 'رقم الهاتف والملف مطلوبان' });
  }
  const fileUrl = '/uploads/' + req.file.filename;
  resultsData.push({ phone, fileUrl, uploadedAt: new Date() });
  res.json({ message: 'تم رفع النتيجة بنجاح', fileUrl });
});

// البحث عن نتيجة
app.get('/api/results/:phone', (req, res) => {
  const phone = req.params.phone;
  const results = resultsData.filter(r => r.phone === phone);
  if (results.length > 0) {
    res.json({ success: true, results });
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

// تسجيل الخروج
app.post('/api/admin/logout', checkAuth, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الخروج' });
    res.json({ message: 'تم تسجيل الخروج بنجاح' });
  });
});

// المستخدمون
app.get('/api/admin/users', checkAuth, (req, res) => {
  const usersWithMessages = usersData.map(user => {
    const userMessages = adminMessages.filter(msg => msg.email === user.email);
    return {
      ...user,
      messages: userMessages.map(m => m.message).join('\n\n') || 'لا توجد رسائل'
    };
  });
  res.json(usersWithMessages);
});

// الحجوزات
app.get('/api/admin/bookings', checkAuth, (req, res) => {
  res.json(bookingsData);
});

// النتائج
app.get('/api/admin/results', checkAuth, (req, res) => {
  res.json(resultsData);
});

// حذف مستخدم
app.delete('/api/admin/user/:email', checkAuth, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const index = usersData.findIndex(user => user.email === email);
  if (index === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });
  usersData.splice(index, 1);
  res.json({ message: `تم حذف المستخدم ${email} بنجاح` });
});

// حذف حجز
app.delete('/api/admin/booking/:phone', checkAuth, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const index = bookingsData.findIndex(b => b.phone === phone);
  if (index === -1) return res.status(404).json({ error: 'الحجز غير موجود' });
  bookingsData.splice(index, 1);
  res.json({ message: `تم حذف الحجز لرقم ${phone} بنجاح` });
});

// حذف نتيجة
app.delete('/api/admin/result/:phone', checkAuth, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const index = resultsData.findIndex(r => r.phone === phone);
  if (index === -1) return res.status(404).json({ error: 'النتيجة غير موجودة' });

  const filePath = path.join(__dirname, 'public', resultsData[index].fileUrl);
  fs.unlink(filePath, (err) => {
    if (err) console.error('فشل في حذف الملف:', err);
  });

  resultsData.splice(index, 1);
  res.json({ message: `تم حذف النتيجة لرقم ${phone} بنجاح` });
});

// إرسال رسالة للعميل (من الادمن)
app.post('/api/admin/message', checkAuth, async (req, res) => {
  const { email, message } = req.body;
  if (!email || !message?.trim()) {
    return res.status(400).json({ error: 'البريد الإلكتروني والرسالة مطلوبين' });
  }

  try {
    await transporter.sendMail({
      from: `"Bedaya" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'مركز Bedaya',
      html: `<p>${message}</p>`
    });

    adminMessages.push({ email, message, sentAt: new Date() });
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
app.delete('/api/admin/message/:email', (req, res) => {
  const email = req.params.email;
  // تنفيذ الحذف من قاعدة البيانات ثم:
  res.json({ message: 'تم حذف الرسالة بنجاح' });
});


// صفحة الادمن
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});
