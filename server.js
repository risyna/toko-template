// FILE: server.js
// Mengimpor library yang dibutuhkan
require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const nodemailer = require('nodemailer');
const path = require('path'); // Tambahan baru untuk membaca lokasi file

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// =========================================================================
// TAMBAHAN BARU: Menampilkan File Halaman Web (Frontend)
// =========================================================================
// Mengizinkan server membaca file HTML, CSS, Gambar di folder ini
app.use(express.static(__dirname));

// Jika seseorang membuka link web utama ( / ), tampilkan index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// =========================================================================
// PENGECEKAN KEAMANAN (.env)
// =========================================================================
if (!process.env.MIDTRANS_SERVER_KEY) {
    console.warn("⚠️ PERINGATAN: File .env belum dibuat atau kunci Midtrans kosong!");
}

// =========================================================================
// 1. KONFIGURASI MIDTRANS
// =========================================================================
let snap = new midtransClient.Snap({
    isProduction: true, 
    serverKey: process.env.MIDTRANS_SERVER_KEY || 'KUNCI_KOSONG',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || 'KUNCI_KOSONG'
});

// =========================================================================
// 2. KONFIGURASI EMAIL
// =========================================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'email_kosong',
        pass: process.env.EMAIL_PASS || 'password_kosong'
    }
});

const pendingOrders = {}; 

// =========================================================================
// API 1: PROSES CHECKOUT DARI WEBSITE
// =========================================================================
app.post('/api/checkout', async (req, res) => {
    try {
        const { contact, sendMethod, htmlData, templateName } = req.body;
        const orderId = "ORDER-" + Math.floor(Math.random() * 1000000);

        pendingOrders[orderId] = {
            contact: contact, 
            sendMethod: sendMethod, 
            htmlData: htmlData, 
            status: 'PENDING'
        };

        let parameter = {
            "transaction_details": { 
                "order_id": orderId, 
                "gross_amount": 15000 
            },
            "customer_details": {
                "email": sendMethod === 'email' ? contact : 'customer@example.com',
                "first_name": "Pembeli", 
                "last_name": "Template"
            },
            "item_details": [{ 
                "id": "TPL-01", 
                "price": 15000, 
                "quantity": 1, 
                "name": templateName 
            }]
        };

        const transaction = await snap.createTransaction(parameter);
        res.json({ 
            status: 'success', 
            orderId: orderId, 
            paymentUrl: transaction.redirect_url 
        });

    } catch (error) {
        console.error("Error Checkout:", error);
        res.status(500).json({ error: 'Gagal membuat pesanan QRIS' });
    }
});

// =========================================================================
// API 2: WEBHOOK MIDTRANS
// =========================================================================
app.post('/api/midtrans-webhook', async (req, res) => {
    try {
        const notificationJson = req.body;
        const statusResponse = await snap.transaction.notification(notificationJson);

        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;

        console.log(`Status Pembayaran ${orderId}: ${transactionStatus}`);

        if (transactionStatus == 'settlement' || transactionStatus == 'capture') {
            const order = pendingOrders[orderId];
            
            if (order && order.status !== 'PAID') {
                order.status = 'PAID';
                
                if (order.sendMethod === 'email') {
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: order.contact,
                        subject: 'Pesanan Template Anda - TemplateHub',
                        text: 'Terima kasih telah membeli! File HTML pesanan Anda sudah terlampir.',
                        attachments: [{ 
                            filename: 'Pesanan_Template_Kamu.html', 
                            content: order.htmlData 
                        }]
                    });
                    console.log("✅ File berhasil dikirim ke Email pembeli!");
                } 
                
                delete pendingOrders[orderId];
            }
        }
        res.status(200).send('OK'); 

    } catch (error) {
        console.error("Error Webhook:", error);
        res.status(500).send('Error');
    }
});

// =========================================================================
// JALANKAN SERVER
// =========================================================================
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    });
}

module.exports = app;