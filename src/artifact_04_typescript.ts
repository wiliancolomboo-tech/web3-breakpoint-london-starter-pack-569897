import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import express, { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_mock_token";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

// Initialize Solana Connection
const connection = new Connection(RPC_URL, "confirmed");

// Load Operator Keypair
const rawKey = process.env.OPERATOR_PRIVATE_KEY
  ? JSON.parse(process.env.OPERATOR_PRIVATE_KEY)
  : Array.from(Keypair.generate().secretKey);
const operatorKeypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));
const wallet = new Wallet(operatorKeypair);
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

// Express Server
const app = express();
app.use(express.json());

// External Integration Adapters
export async function sendEmailTicket(
  recipientEmail: string,
  attendeePubkey: string,
  eventId: string,
  tier: string
): Promise<void> {
  const qrPayload = JSON.stringify({
    event_id: eventId,
    attendee: attendeePubkey,
    timestamp: Date.now(),
  });

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrPayload)}`;

  try {
    const response = await axios.post(
      "https://api.resend.com/emails",
      {
        from: "Breakpoint London <tickets@solanabreakpoint.io>",
        to: [recipientEmail],
        subject: `Your Solana Breakpoint London Pass [Tier: ${tier}]`,
        html: `
          <div style="font-family: Arial, sans-serif; background: #0c0d14; color: #fff; padding: 32px; border-radius: 12px; text-align: center;">
            <h1 style="color: #14F195;">Solana Breakpoint London</h1>
            <p style="font-size: 16px; color: #9945FF;">Welcome to the premier Solana ecosystem event.</p>
            <div style="margin: 24px 0;">
              <img src="${qrImageUrl}" alt="Check-in Pass QR" style="border: 4px solid #14F195; border-radius: 8px; width: 220px;" />
            </div>
            <p><strong>Tier:</strong> ${tier}</p>
            <p style="word-break: break-all; font-family: monospace; font-size: 12px; color: #aaa;">
              <strong>Attendee Pubkey:</strong> ${attendeePubkey}
            </p>
            <p style="font-size: 12px; color: #666;">Present this QR code at the registration gate at ExCeL London.</p>
          </div>
        `,
      },
      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`[Resend] Successfully dispatched pass email: ${response.data.id}`);
  } catch (error: any) {
    console.error(`[Resend Error] Failed to send ticket: ${error.response?.data?.message || error.message}`);
  }
}

export async function broadcastTelemetry(message: string, fields: Array<{ name: string; value: string }>): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.log(`[Telemetry - Console Only]: ${message}`);
    return;
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      username: "Breakpoint London Gate Sentinel",
      avatar_url: "https://solana.com/favicon.png",
      embeds: [
        {
          title: "🚨 Ingress Telemetry Event",
          description: message,
          color: 0x14f195, // Solana Green
          fields: fields,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (error: any) {
    console.error(`[Webhook Error] Failed to stream telemetry: ${error.message}`);
  }
}

// REST Endpoints
app.get("/health", async (_req: Request, res: Response) => {
  const slot = await connection.getSlot();
  res.status(200).json({
    status: "healthy",
    cluster: RPC_URL,
    current_slot: slot,
    operator: operatorKeypair.publicKey.toBase58(),
  });
});

app.post("/api/v1/passes/issue", async (req: Request, res: Response) => {
  const { attendeePubkey, eventId, tier, email } = req.body;

  if (!attendeePubkey || !eventId || !tier || !email) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  // Trigger transactional email
  await sendEmailTicket(email, attendeePubkey, eventId, tier);

  await broadcastTelemetry("New Breakpoint Pass Generated", [
    { name: "Event ID", value: eventId },
    { name: "Attendee", value: attendeePubkey },
    { name: "Tier", value: tier },
  ]);

  return res.status(200).json({
    success: true,
    message: "Pass issued and credential email sent.",
    attendee: attendeePubkey,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Breakpoint London Gateway Engine active on port ${PORT}`);
    console.log(`Operator Authority: ${operatorKeypair.publicKey.toBase58()}`);
    console.log(`====================================================`);
  });
}