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

// ========== تهيئة Firebase ==========
let db;
try {
  // قراءة إعدادات Firebase من متغير البيئة
  const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  
  // تهيئة التطبيق
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
      databaseURL: `https://${firebaseConfig.project_id}.firebaseio.com` // لـ Realtime Database
    });
  }
  
  db = admin.firestore(); // استخدام Firestore (موصى به)
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
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

// توليد التوكن
function generateToken(user) {
  return jwt.sign(
    { 
      user,
      exp: Math.floor(Date.now() / 1000) + (60 * 60)
    }, 
    process.env.SESSION_SECRET
  );
}

// Middleware المصادقة
async function checkAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      error: 'غير مصرح بالوصول',
      details: 'لم يتم توفير توكن'
    });
  }

  jwt.verify(token, process.env.SESSION_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ 
        error: 'غير مصرح بالوصول',
        details: 'توكن غير صالح أو منتهي الصلاحية'
      });
    }
    
    req.user = decoded.user;
    next();
  });
}

// ========== Routes ========== //

// استقبال بيانات المستخدم
app.post('/api/submit', async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'الرجاء ملء جميع الحقول' });
  }
  
  try {
    const userData = { 
      name, 
      email, 
      phone, 
      receivedAt: new Date().toISOString() 
    };
    
    await db.collection('users').add(userData);
    res.json({ message: 'تم استلام البيانات بنجاح' });
  } catch (error) {
    console.error('Error saving user:', error);
    res.status(500).json({ error: 'حدث خطأ في حفظ البيانات' });
  }
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

    await db.collection('adminMessages').add({
      email, 
      message, 
      name, 
      phone: req.body.phone || null, 
      sentAt: new Date().toISOString()
    });

    res.json({ message: 'تم إرسال الرسالة بنجاح' });

  } catch (err) {
    console.error('خطأ في إرسال الرسالة:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة' });
  }
});

// حجز موعد
app.post('/api/booking', async (req, res) => {
  const { name, phone, date, time } = req.body;
  if (!name || !phone || !date || !time) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  try {
    const bookingData = { 
      name, 
      phone, 
      date, 
      time, 
      receivedAt: new Date().toISOString() 
    };
    
    await db.collection('bookings').add(bookingData);

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
  } catch (error) {
    console.error('Error saving booking:', error);
    res.status(500).json({ error: 'حدث خطأ في حفظ الحجز' });
  }
});

// رفع نتيجة
app.post('/api/upload-result', upload.single('resultFile'), async (req, res) => {
  const { phone } = req.body;
  if (!phone || !req.file) {
    return res.status(400).json({ error: 'رقم الهاتف والملف مطلوبان' });
  }
  
  try {
    const fileUrl = '/uploads/' + req.file.filename;
    const resultData = { 
      phone, 
      fileUrl, 
      uploadedAt: new Date().toISOString() 
    };
    
    await db.collection('results').add(resultData);
    res.json({ message: 'تم رفع النتيجة بنجاح', fileUrl });
  } catch (error) {
    console.error('Error uploading result:', error);
    res.status(500).json({ error: 'حدث خطأ في رفع النتيجة' });
  }
});

// البحث عن نتيجة
app.get('/api/results/:phone', async (req, res) => {
  const phone = req.params.phone;
  
  try {
    const snapshot = await db.collection('results')
      .where('phone', '==', phone)
      .get();
    
    const results = [];
    snapshot.forEach(doc => {
      results.push({ id: doc.id, ...doc.data() });
    });
    
    if (results.length > 0) {
      res.json({ success: true, results });
    } else {
      res.status(404).json({ success: false, message: 'لا توجد نتائج لهذا الرقم' });
    }
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'حدث خطأ في البحث' });
  }
});

// تسجيل دخول الادمن
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = generateToken({ username });
    res.json({ 
      message: 'تم تسجيل الدخول بنجاح',
      token
    });
  } else {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
});

// التحقق من صحة التوكن
app.get('/api/admin/verify-token', checkAuth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// تسجيل الخروج
app.post('/api/admin/logout', checkAuth, (req, res) => {
  res.json({ 
    message: 'تم تسجيل الخروج بنجاح',
    logoutTime: new Date().toISOString()
  });
});

// نظام المبيعات
app.post('/api/admin/sales', checkAuth, async (req, res) => {
  const { customerName, amount } = req.body;
  
  if (!customerName || !amount || isNaN(amount)) {
    return res.status(400).json({ error: 'اسم العميل ومبلغ البيع (رقم) مطلوبان' });
  }

  try {
    const newSale = {
      id: Date.now().toString(),
      customerName,
      amount: parseFloat(amount),
      saleTime: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    await db.collection('sales').doc(newSale.id).set(newSale);
    
    res.status(201).json({
      message: 'تم تسجيل عملية البيع بنجاح',
      sale: newSale
    });
  } catch (error) {
    console.error('Error saving sale:', error);
    res.status(500).json({ error: 'حدث خطأ في تسجيل البيع' });
  }
});

// الحصول على مبيعات اليوم
app.get('/api/admin/sales/today', checkAuth, async (req, res) => {
  try {
    const today = new Date();
    const todayStart = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const todayEnd = new Date(today.setHours(23, 59, 59, 999)).toISOString();

    const snapshot = await db.collection('sales')
      .where('saleTime', '>=', todayStart)
      .where('saleTime', '<=', todayEnd)
      .get();
    
    const todaySales = [];
    let todayTotal = 0;
    
    snapshot.forEach(doc => {
      const sale = doc.data();
      todaySales.push(sale);
      todayTotal += sale.amount;
    });

    res.json({
      sales: todaySales,
      todayTotal
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'حدث خطأ في جلب المبيعات' });
  }
});

// تعديل عملية بيع
app.put('/api/admin/sale/:id', checkAuth, async (req, res) => {
  const saleId = req.params.id;
  const { customerName, amount } = req.body;

  if (!customerName || !amount || isNaN(amount)) {
    return res.status(400).json({ error: 'اسم العميل ومبلغ البيع (رقم) مطلوبان' });
  }

  try {
    const saleRef = db.collection('sales').doc(saleId);
    const saleDoc = await saleRef.get();
    
    if (!saleDoc.exists) {
      return res.status(404).json({ error: 'عملية البيع غير موجودة' });
    }

    const updatedSale = {
      ...saleDoc.data(),
      customerName,
      amount: parseFloat(amount),
      updatedAt: new Date().toISOString()
    };

    await saleRef.update(updatedSale);

    res.json({
      message: 'تم تحديث عملية البيع بنجاح',
      sale: updatedSale
    });
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ error: 'حدث خطأ في تحديث البيع' });
  }
});

// حذف عملية بيع
app.delete('/api/admin/sale/:id', checkAuth, async (req, res) => {
  const saleId = req.params.id;

  try {
    const saleRef = db.collection('sales').doc(saleId);
    const saleDoc = await saleRef.get();
    
    if (!saleDoc.exists) {
      return res.status(404).json({ error: 'عملية البيع غير موجودة' });
    }

    await saleRef.delete();

    res.json({
      message: 'تم حذف عملية البيع بنجاح'
    });
  } catch (error) {
    console.error('Error deleting sale:', error);
    res.status(500).json({ error: 'حدث خطأ في حذف البيع' });
  }
});

// المستخدمون
app.get('/api/admin/users', checkAuth, async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    const messagesSnapshot = await db.collection('adminMessages').get();
    
    const users = [];
    const messagesMap = new Map();
    
    messagesSnapshot.forEach(doc => {
      const msg = doc.data();
      if (!messagesMap.has(msg.email)) {
        messagesMap.set(msg.email, []);
      }
      messagesMap.get(msg.email).push(msg.message);
    });
    
    usersSnapshot.forEach(doc => {
      const user = doc.data();
      const userMessages = messagesMap.get(user.email) || [];
      users.push({
        ...user,
        messages: userMessages.join('\n\n') || 'لا توجد رسائل'
      });
    });
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'حدث خطأ في جلب المستخدمين' });
  }
});

// الحجوزات
app.get('/api/admin/bookings', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('bookings').get();
    const bookings = [];
    snapshot.forEach(doc => bookings.push({ id: doc.id, ...doc.data() }));
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'حدث خطأ في جلب الحجوزات' });
  }
});

// النتائج
app.get('/api/admin/results', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('results').get();
    const results = [];
    snapshot.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
    res.json(results);
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'حدث خطأ في جلب النتائج' });
  }
});

// حذف مستخدم
app.delete('/api/admin/user/:email', checkAuth, async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  
  try {
    const snapshot = await db.collection('users')
      .where('email', '==', email)
      .get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    
    res.json({ message: `تم حذف المستخدم ${email} بنجاح` });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'حدث خطأ في حذف المستخدم' });
  }
});

// حذف حجز
app.delete('/api/admin/booking/:phone', checkAuth, async (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  
  try {
    const snapshot = await db.collection('bookings')
      .where('phone', '==', phone)
      .get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'الحجز غير موجود' });
    }
    
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    
    res.json({ message: `تم حذف الحجز لرقم ${phone} بنجاح` });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'حدث خطأ في حذف الحجز' });
  }
});

// تعديل نتيجة موجودة
app.put('/api/admin/result/:phone', upload.single('resultFile'), checkAuth, async (req, res) => {
  const oldPhone = decodeURIComponent(req.params.phone);
  const newPhone = req.body.phone;
  const resultFile = req.file;
  
  if (!newPhone) {
    return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
  }
  
  try {
    const snapshot = await db.collection('results')
      .where('phone', '==', oldPhone)
      .get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'النتيجة غير موجودة' });
    }
    
    const doc = snapshot.docs[0];
    const resultData = doc.data();
    
    // حذف الملف القديم إذا كان موجوداً وكان هناك ملف جديد
    if (resultFile && resultData.fileUrl) {
      const oldFilePath = path.join(__dirname, 'public', resultData.fileUrl);
      fs.unlink(oldFilePath, (err) => {
        if (err) console.error('فشل في حذف الملف القديم:', err);
      });
    }
    
    const updatedData = {
      phone: newPhone,
      updatedAt: new Date().toISOString()
    };
    
    if (resultFile) {
      updatedData.fileUrl = '/uploads/' + resultFile.filename;
    } else {
      updatedData.fileUrl = resultData.fileUrl;
    }
    
    await doc.ref.update(updatedData);
    
    res.json({ 
      message: 'تم تحديث النتيجة بنجاح',
      result: { id: doc.id, ...resultData, ...updatedData }
    });
  } catch (error) {
    console.error('Error updating result:', error);
    res.status(500).json({ error: 'حدث خطأ في تحديث النتيجة' });
  }
});

// حذف نتيجة
app.delete('/api/admin/result/:phone', checkAuth, async (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  
  try {
    const snapshot = await db.collection('results')
      .where('phone', '==', phone)
      .get();
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'النتيجة غير موجودة' });
    }
    
    const doc = snapshot.docs[0];
    const resultData = doc.data();
    
    // حذف الملف من السيرفر
    if (resultData.fileUrl) {
      const filePath = path.join(__dirname, 'public', resultData.fileUrl);
      fs.unlink(filePath, (err) => {
        if (err) console.error('فشل في حذف الملف:', err);
      });
    }
    
    await doc.ref.delete();
    
    res.json({ message: `تم حذف النتيجة لرقم ${phone} بنجاح` });
  } catch (error) {
    console.error('Error deleting result:', error);
    res.status(500).json({ error: 'حدث خطأ في حذف النتيجة' });
  }
});

// إرسال رسالة للعميل
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

    await db.collection('adminMessages').add({
      email,
      message,
      sentAt: new Date().toISOString()
    });

    res.json({ message: 'تم إرسال الرسالة بنجاح' });

  } catch (err) {
    console.error('خطأ في إرسال الإيميل:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال الإيميل' });
  }
});

// جلب الرسائل
app.get('/api/admin/messages', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('adminMessages')
      .orderBy('sentAt', 'desc')
      .get();
    
    const messages = [];
    snapshot.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
    
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'حدث خطأ في جلب الرسائل' });
  }
});

// حذف رسالة
app.delete('/api/admin/message/:id', checkAuth, async (req, res) => {
  const id = req.params.id;
  
  try {
    await db.collection('adminMessages').doc(id).delete();
    res.json({ message: 'تم حذف الرسالة بنجاح' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'حدث خطأ في حذف الرسالة' });
  }
});

// صفحة الادمن
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log(`📊 Using Firebase Firestore as database`);
});
