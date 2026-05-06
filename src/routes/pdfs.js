const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const puppeteer = require('puppeteer-core');
const QRCode = require('qrcode');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { generateUUID } = require('../utils/uuid');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const bucketName = process.env.AWS_BUCKET_NAME;

// POST /api/pdfs/generate
router.post('/generate', authenticate, async (req, res) => {
    try {
        const { type, data } = req.body;

        let htmlContent = '';

        if (type === 'ticket') {
            // Generate QR Code as Data URI
            const qrData = encodeURIComponent(`Tracking: ${data.trackingCode}\nSource: ${data.source}\nDest: ${data.dest}\nPoids: ${data.weight} Kg`);
            const qrUrlContent = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${qrData}`;

            htmlContent = `
                <html>
                    <body style="font-family: Arial, sans-serif; padding: 40px; border: 2px dashed #333; max-width: 600px; margin: auto;">
                    <h1 style="text-align: center; color: #1E40AF; text-transform: uppercase;">ETIQUETTE DE VOYAGE</h1>
                    <div style="text-align: center; margin-bottom: 20px;">
                        <img src="${qrUrlContent}" width="150" height="150" />
                    </div>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                        <tr><td style="padding: 12px; border: 1px solid #ddd; background: #f9f9f9;"><strong>N° de Suivi</strong></td><td style="padding: 12px; border: 1px solid #ddd;">${data.trackingCode}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Source</strong></td><td style="padding: 12px; border: 1px solid #ddd;">${data.source}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Destination</strong></td><td style="padding: 12px; border: 1px solid #ddd;">${data.dest}</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Kgs (Poids)</strong></td><td style="padding: 12px; border: 1px solid #ddd;">${data.weight} Kg</td></tr>
                        <tr><td style="padding: 12px; border: 1px solid #ddd; background: #f9f9f9;"><strong>Statut</strong></td><td style="padding: 12px; border: 1px solid #ddd; color: green; font-weight: bold;">${data.status}</td></tr>
                    </table>
                    <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #555;">
                        Généré automatiquement par RM Tawssil. Veuillez coller cette étiquette sur le colis.
                    </div>
                    </body>
                </html>
            `;
        } else if (type === 'export') {
            const currentDateTime = new Date().toLocaleString('fr-FR');
            htmlContent = `
                <html>
                    <head>
                        <meta charset="utf-8">
                        <style>
                            body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 40px; color: #333; }
                            h1 { color: #1E40AF; border-bottom: 2px solid #1E40AF; padding-bottom: 10px; }
                            h2 { color: #1E40AF; margin-top: 30px; font-size: 18px; }
                            .header-info { color: #666; font-size: 14px; margin-bottom: 40px; }
                            .data-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                            .data-table th, .data-table td { padding: 12px; text-align: left; border-bottom: 1px solid #E5E7EB; font-size: 14px; }
                            .data-table th { background-color: #F3F4F6; width: 35%; font-weight: bold; color: #374151; }
                            .footer { margin-top: 50px; font-size: 12px; color: #999; text-align: center; border-top: 1px solid #E5E7EB; padding-top: 20px; }
                            .badge { background-color: #10B981; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
                        </style>
                    </head>
                    <body>
                        <h1>Rapport de Données Personnelles</h1>
                        <div class="header-info">
                            <p><strong>Plateforme :</strong> RM TAWSSIL</p>
                            <p><strong>Généré le :</strong> ${currentDateTime}</p>
                            <p><strong>Document généré automatiquement à la demande du titulaire du compte.</strong></p>
                        </div>
                        <h2>Informations du compte</h2>
                        <table class="data-table">
                            <tr><th>Identifiant (ID)</th><td>${data.id || 'N/A'}</td></tr>
                            <tr><th>Nom complet</th><td>${data.fullName || 'N/A'}</td></tr>
                            <tr><th>Email</th><td>${data.email || 'N/A'}</td></tr>
                            <tr><th>Téléphone</th><td>${data.phone || 'Non renseigné'}</td></tr>
                            <tr><th>Rôle sur la plateforme</th><td><span class="badge">${data.role || 'CLIENT'}</span></td></tr>
                        </table>
                        <h2>Informations Légales</h2>
                        <p style="font-size: 13px; line-height: 1.6; color: #555;">
                            Ce document regroupe les données personnelles d'identification rattachées à votre profil sur la plateforme RM TAWSSIL, 
                            conformément à votre droit d'accès et de portabilité garanti par la loi n°09-08 au Maroc. 
                        </p>
                        <div class="footer">
                            Document personnel et confidentiel généré par l'application RM TAWSSIL.<br>
                            En cas de question, contactez dpo@rmtawssil.com.
                        </div>
                    </body>
                </html>
            `;
        } else {
            return res.status(400).json({ error: 'Invalid document type' });
        }

        // Initialize Puppeteer-Core
        const browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' // Fallback to common Linux path
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        // Generate PDF
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        // Upload to AWS S3
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileName = `pdfs/${type}_${uniqueSuffix}.pdf`;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: fileName,
            Body: pdfBuffer,
            ContentType: 'application/pdf',
        });

        await s3Client.send(command);

        // Construct the S3 URL
        const region = process.env.AWS_REGION || 'eu-west-3';
        const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${fileName}`;

        res.status(200).json({ url: fileUrl });
    } catch (err) {
        console.error('POST /pdfs/generate Error:', err);
        res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
    }
});

module.exports = router;
