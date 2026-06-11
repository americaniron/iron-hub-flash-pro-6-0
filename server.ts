
import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FREE_TIER_GEMINI_MODELS = new Set([
  "gemini-3.1-flash-lite",
]);

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return Buffer.from(binary, "binary").toString("base64");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // AI Status Check
  app.get("/api/ai-status", (req, res) => {
    const geminiConfigured = !!process.env.GEMINI_API_KEY;
    const elevenLabsConfigured = !!process.env.ELEVENLABS_API_KEY;
    res.json({ 
      configured: geminiConfigured && elevenLabsConfigured,
      mode: "server-proxy",
      providers: {
        gemini: geminiConfigured,
        elevenlabs: elevenLabsConfigured,
      },
    });
  });

  // Gemini Proxy Endpoint
  app.post("/api/gemini", async (req, res) => {
    const { model, contents, config } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      console.error("Gemini Proxy Error: GEMINI_API_KEY is not set in environment.");
      return res.status(500).json({ 
        error: "Gemini API key not configured on server. Please set GEMINI_API_KEY in the environment." 
      });
    }

    if (!FREE_TIER_GEMINI_MODELS.has(model)) {
      return res.status(400).json({
        error: `Model ${model} is not enabled. This app is restricted to free-tier Gemini models.`,
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Handle both single string contents and complex parts/contents
      const response = await ai.models.generateContent({
        model,
        contents,
        config
      });
      
      // Return the full response object
      res.json(response);
    } catch (error) {
      console.error("Gemini Proxy Error:", error);
      res.status(500).json({ 
        error: "Gemini API Error", 
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  app.post("/api/elevenlabs-tts", async (req, res) => {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "ElevenLabs API key not configured. Please set ELEVENLABS_API_KEY in the environment.",
      });
    }

    const {
      text,
      voice_id = "pNInz6obpgDQGcFmaJgB",
      model_id = "eleven_multilingual_v2",
      stability = 0.5,
      similarity_boost = 0.75,
    } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Missing required field: text" });
    }

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id,
          voice_settings: {
            stability,
            similarity_boost,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetail;
        try { errorDetail = JSON.parse(errorText); } catch { errorDetail = { message: errorText }; }
        return res.status(response.status).json({
          error: "ElevenLabs API Error",
          details: errorDetail?.detail?.message || errorText,
          status: response.status,
        });
      }

      const audioBuffer = await response.arrayBuffer();
      res.json({
        audioBase64: arrayBufferToBase64(audioBuffer),
        mimeType: "audio/mpeg",
      });
    } catch (error) {
      res.status(500).json({
        error: "ElevenLabs API Error",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // API Route for sending emails
  app.post("/api/test-email", async (req, res) => {
  try {
    console.log("--- SMTP Connection Test Started ---");
    
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("Test failed: Missing credentials.");
      return res.status(400).json({ 
        error: "Missing SMTP credentials. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS in the AI Studio environment variables." 
      });
    }

    const port = parseInt(process.env.SMTP_PORT || "587");
    let isSecure = port === 465;
    if (process.env.SMTP_SECURE === "true") isSecure = true;
    if (process.env.SMTP_SECURE === "false") isSecure = false;
    
    const cleanPass = process.env.SMTP_PASS.trim();

    console.log(`Testing connection to ${process.env.SMTP_HOST}:${port} (Secure: ${isSecure})`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: port,
      secure: isSecure,
      auth: {
        user: process.env.SMTP_USER,
        pass: cleanPass,
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000,
      tls: {
        rejectUnauthorized: false
      }
    });

    console.log("Verifying SMTP connection...");
    await transporter.verify();
    console.log("SMTP connection verified successfully.");

    // Send a minimal test email to the sender themselves
    const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    console.log(`Sending test email to ${senderEmail}...`);
    const info = await transporter.sendMail({
      from: `"American Iron Test" <${senderEmail}>`,
      to: senderEmail,
      subject: "SMTP Connection Test - American Iron Dispatch",
      text: "This is a test email to verify your SMTP configuration. If you received this, your email dispatch system is correctly configured.",
      html: `<div style="font-family: sans-serif; padding: 20px; border: 2px solid #fbbf24; border-radius: 12px; background-color: #fffbeb;">
              <h2 style="color: #000; margin-top: 0;">Connection Test Successful</h2>
              <p>Your SMTP configuration for the <strong>American Iron Dispatch Hub</strong> is working correctly.</p>
              <hr style="border: none; border-top: 1px solid #fde68a; margin: 20px 0;" />
              <p style="font-size: 12px; color: #92400e;">Timestamp: ${new Date().toISOString()}</p>
            </div>`
    });

    console.log("Test email sent: %s", info.messageId);
    console.log("--- SMTP Connection Test Completed Successfully ---");

    res.json({ 
      success: true, 
      message: "SMTP connection verified and test email sent successfully.",
      messageId: info.messageId
    });

  } catch (error) {
    console.error("--- SMTP Connection Test Failed ---");
    console.error(error);
    res.status(500).json({ 
      error: "SMTP Test Failed", 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

app.post("/api/send-email", async (req, res) => {
    const { to, subject, body, attachment, filename, attachments } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // ... (transporter setup code)
      
      let transporter;
      let isSimulated = false;
      
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const port = parseInt(process.env.SMTP_PORT || "587");
        let isSecure = port === 465;
        if (process.env.SMTP_SECURE === "true") isSecure = true;
        if (process.env.SMTP_SECURE === "false") isSecure = false;
        
        const cleanPass = process.env.SMTP_PASS.trim();

        console.log(`Attempting SMTP connection to ${process.env.SMTP_HOST}:${port} (Secure: ${isSecure})`);

        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: port,
          secure: isSecure,
          auth: {
            user: process.env.SMTP_USER,
            pass: cleanPass,
          },
          connectionTimeout: 30000, // 30 seconds
          greetingTimeout: 30000,
          socketTimeout: 60000, // 60 seconds for large attachments
          tls: {
            rejectUnauthorized: false
          }
        });
      } else {
        isSimulated = true;
      }

      if (isSimulated) {
        console.log("No SMTP credentials provided. Simulating email send.");
        await new Promise(resolve => setTimeout(resolve, 1500));
        return res.json({ 
          success: true, 
          messageId: `simulated-${Date.now()}`,
          simulated: true,
          note: "Email was simulated. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS in the AI Studio environment variables to send real emails."
        });
      } else {
        try {
          console.log("Verifying SMTP connection...");
          await transporter.verify();
          console.log("SMTP connection verified successfully.");
        } catch (verifyError) {
          console.error("SMTP Verification Error:", verifyError);
          return res.status(500).json({ 
            error: "SMTP Connection/Authentication Failed. Check your App Password and Port.", 
            details: verifyError instanceof Error ? verifyError.message : String(verifyError) 
          });
        }
      }

      const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER || 'dispatch@americanironus.com';
      
      // Prepare attachments array
      const emailAttachments = [];
      const processAttachment = (att) => {
        if (att.path && typeof att.path === 'string' && att.path.startsWith('data:')) {
          const parts = att.path.split(';base64,');
          if (parts.length === 2) {
            const mimeType = parts[0].split(':')[1]?.split(';')[0] || 'application/octet-stream';
            console.log(`Processing base64 attachment: ${att.filename} (${mimeType})`);
            return {
              filename: att.filename,
              content: parts[1],
              encoding: 'base64',
              contentType: mimeType
            };
          }
        }
        return att;
      };

      if (attachments && Array.isArray(attachments)) {
        console.log(`Preparing ${attachments.length} attachments...`);
        emailAttachments.push(...attachments.map(processAttachment));
      } else if (attachment) {
        console.log("Preparing single legacy attachment...");
        emailAttachments.push(processAttachment({
          filename: filename || 'Document.pdf',
          path: attachment
        }));
      }

      console.log(`Sending email to [REDACTED] with ${emailAttachments.length} attachments...`);
      const info = await transporter.sendMail({
        from: `"American Iron Dispatch" <${senderEmail}>`,
        to,
        subject,
        text: body,
        html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #000;">American Iron Dispatch</h2>
                <hr />
                <div style="white-space: pre-wrap;">${body}</div>
                <hr />
                <p style="font-size: 12px; color: #666;">This is an automated dispatch from the American Iron Invoicing System.</p>
              </div>`,
        attachments: emailAttachments
      });

      console.log("Message sent successfully: %s", info.messageId);
      const previewUrl = nodemailer.getTestMessageUrl(info);
      
      res.json({ 
        success: true, 
        messageId: info.messageId,
        previewUrl: previewUrl || undefined 
      });
    } catch (error) {
      console.error("Email error:", error);
      res.status(500).json({ error: "Failed to send email", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
