// FILE: server.js
// Mengimpor library yang dibutuhkan
require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// =========================================================================
// Menampilkan File Halaman Web (Frontend)
// =========================================================================
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// =========================================================================
// PENGECEKAN KEAMANAN (.env)
// =========================================================================
if (!process.env.MIDTRANS_SERVER_KEY || !process.env.EMAIL_PASS) {
    console.warn("⚠️ PERINGATAN: File .env belum dibuat atau kunci Midtrans/Email kosong!");
}

// =========================================================================
// 1. KONFIGURASI MIDTRANS
// =========================================================================
let snap = new midtransClient.Snap({
    isProduction: true, // Pastikan Anda menggunakan Server Key Production di Vercel
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY 
});

// =========================================================================
// 2. KONFIGURASI EMAIL (NODEMAILER)
// =========================================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS 
    }
});

// Penyimpanan sementara di memori
const pendingOrders = {}; 

// =========================================================================
// API 1: PROSES CHECKOUT DARI WEBSITE
// =========================================================================
app.post('/api/checkout', async (req, res) => {
    try {
        const { contact, sendMethod, htmlData, templateName } = req.body;
        
        // PERBAIKAN: Menggunakan Date.now() agar Order ID tidak mungkin kembar
        const orderId = "JVRO-" + Date.now();

        pendingOrders[orderId] = {
            contact: contact, 
            sendMethod: sendMethod, 
            htmlData: htmlData, 
            status: 'PENDING'
        };
        
        console.log(`[CHECKOUT] Pesanan dibuat: ${orderId}. Menunggu pembayaran...`);

        let parameter = {
            "transaction_details": { 
                "order_id": orderId, 
                "gross_amount": 15000 
            },
            "customer_details": {
                "email": sendMethod === 'email' ? contact : 'customer@example.com',
                "first_name": "Sobat", 
                "last_name": "Jvro"
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
// API 2: WEBHOOK MIDTRANS (TELAH DIPERBAIKI)
// =========================================================================
// PERBAIKAN: URL disamakan dengan konfigurasi di dashboard Midtrans
app.post('/api/webhook', async (req, res) => {
    try {
        const notificationJson = req.body;
        const statusResponse = await snap.transaction.notification(notificationJson);

        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;

        console.log(`[WEBHOOK] Status Pembayaran ${orderId}: ${transactionStatus}`);

        // Jika pembayaran sukses
        if (transactionStatus == 'settlement' || transactionStatus == 'capture') {
            const order = pendingOrders[orderId];
            
            // Pengecekan jika memori hilang karena Vercel tertidur
            if (!order) {
                console.error(`🚨 ERROR KRITIS: Data HTML untuk pesanan ${orderId} hilang dari memori Vercel. Email gagal dikirim!`);
                return res.status(200).send('OK'); 
            }
            
            if (order.status !== 'PAID') {
                order.status = 'PAID';
                
                if (order.sendMethod === 'email') {
                    console.log(`[EMAIL] Mencoba mengirim file ke: ${order.contact}...`);
                    await transporter.sendMail({
                        from: `"Jvro Finance" <${process.env.EMAIL_USER}>`,
                        to: order.contact,
                        subject: '🚀 File Template Website Anda Sudah Siap!',
                        text: 'Terima kasih telah berbelanja di Jvro! File HTML pesanan Anda sudah kami lampirkan pada email ini. Silakan unduh dan buka menggunakan browser (Chrome/Safari).',
                        attachments: [{ 
                            filename: `Jvro_Template_${orderId}.html`, 
                            content: order.htmlData 
                        }]
                    });
                    console.log(`✅ SUKSES: File berhasil dikirim ke Email pembeli (${order.contact})!`);
                } 
                
                // Hapus dari memori untuk menghemat RAM
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