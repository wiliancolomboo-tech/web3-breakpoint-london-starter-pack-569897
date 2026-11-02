import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

// Configuration Interfaces
interface DaemonConfig {
  rpcUrl: string;
  programId: string;
  adminKeypair: Keypair;
  resendApiKey: string;
  discordWebhookUrl: string;
  slackWebhookUrl?: string;
  eventId: string;
}

export class BreakpointEnterpriseService {
  private connection: Connection;
  private provider: AnchorProvider;
  private programId: PublicKey;
  private config: DaemonConfig;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    const wallet = new Wallet(config.adminKeypair);
    this.provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    this.programId = new PublicKey(config.programId);
  }

  /**
   * Derive Program Derived Addresses (PDAs)
   */
  public findEventStatePda(eventId: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("event"), Buffer.from(eventId)],
      this.programId
    );
  }

  public findPassPda(eventId: string, recipient: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pass"), Buffer.from(eventId), recipient.toBuffer()],
      this.programId
    );
  }

  public findEscrowPda(eventId: string, sponsor: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), Buffer.from(eventId), sponsor.toBuffer()],
      this.programId
    );
  }

  /**
   * Enterprise Gateway: Dispatch dynamic Breakpoint London Ticket via Resend API
   */
  public async sendDynamicTicketEmail(
    attendeeEmail: string,
    recipientPubkey: string,
    tier: string
  ): Promise<boolean> {
    if (!this.config.resendApiKey) {
      console.warn("[WARN] RESEND_API_KEY missing. Skipping email dispatch.");
      return false;
    }

    const qrVerificationPayload = `solana:breakpoint:london:${this.config.eventId}:${recipientPubkey}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(
      qrVerificationPayload
    )}`;

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0e14; color: #ffffff; padding: 32px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #14F195; font-size: 28px; margin-bottom: 8px;">Solana Breakpoint London</h1>
        <p style="color: #9945FF; font-weight: bold; margin-top: 0; text-transform: uppercase;">Official Verified Attendee Pass</p>
        <hr style="border: 1px solid #232738; margin: 24px 0;" />
        <p>Welcome to Breakpoint London! Your on-chain credential has been provisioned.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="color: #8892b0; padding: 6px 0;">Attendee Wallet:</td>
            <td style="font-family: monospace; color: #ffffff;">${recipientPubkey.slice(0, 6)}...${recipientPubkey.slice(-6)}</td>
          </tr>
          <tr>
            <td style="color: #8892b0; padding: 6px 0;">Pass Tier:</td>
            <td style="color: #14F195; font-weight: 600;">${tier}</td>
          </tr>
          <tr>
            <td style="color: #8892b0; padding: 6px 0;">Event ID:</td>
            <td style="font-family: monospace;">${this.config.eventId}</td>
          </tr>
        </table>
        <div style="text-align: center; margin: 24px 0;">
          <img src="${qrCodeUrl}" alt="Breakpoint Pass QR" style="border: 4px solid #14F195; border-radius: 8px; padding: 8px; background: white;" />
          <p style="font-size: 12px; color: #8892b0; margin-top: 8px;">Present this cryptographic QR at the ExCeL London fast-track turnstile</p>
        </div>
        <p style="font-size: 12px; color: #5b6479; text-align: center;">Verified and Secured by Solana SVM & Breakpoint London Starter Pack</p>
      </div>
    `;

    try {
      const response = await axios.post(
        "https://api.resend.com/emails",
        {
          from: "Breakpoint London <tickets@solanabreakpoint.org>",
          to: [attendeeEmail],
          subject: `🎟️ Your Solana Breakpoint London Pass [${tier}]`,
          html: htmlBody,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.resendApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(`[Resend] Successfully dispatched pass email to ${attendeeEmail} (ID: ${response.data.id})`);
      return true;
    } catch (err: any) {
      console.error(`[Resend Error] Failed to send ticket email: ${err?.response?.data || err.message}`);
      return false;
    }
  }

  /**
   * Enterprise Webhook: Notify Sponsor Discord & Slack Channels upon grant/swag claims
   */
  public async notifySponsorWebhook(
    event: "CLAIM" | "CHECKIN",
    recipient: string,
    details: string
  ): Promise<void> {
    const payload = {
      username: "Breakpoint Sentinel Bot",
      avatar_url: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      embeds: [
        {
          title: event === "CLAIM" ? "🎁 Sponsor Swag / Grant Claimed" : "⚡ Attendee Turnstile Check-In",
          color: event === "CLAIM" ? 0x14f195 : 0x9945ff,
          fields: [
            { name: "Attendee", value: `\`${recipient}\``, inline: true },
            { name: "Event", value: this.config.eventId, inline: true },
            { name: "Details", value: details, inline: false },
          ],
          footer: { text: "Breakpoint London Starter Pack Protocol" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    if (this.config.discordWebhookUrl) {
      try {
        await axios.post(this.config.discordWebhookUrl, payload);
        console.log(`[Webhook] Sent Discord telemetry for ${recipient}`);
      } catch (err: any) {
        console.error(`[Webhook Error] Failed to send Discord dispatch: ${err.message}`);
      }
    }
  }

  /**
   * Real-time WebSocket listener on program logs
   */
  public startEventListener(): void {
    console.log(`[Sentinel] Actively monitoring logs for Program: ${this.programId.toBase58()}`);
    this.connection.onLogs(
      this.programId,
      async (logs) => {
        if (logs.err) return;
        for (const log of logs.logs) {
          if (log.includes("PassIssued")) {
            console.log(`[Event Detected] PassIssued -> Processing email queuing...`);
          } else if (log.includes("AttendeeCheckedIn")) {
            console.log(`[Event Detected] AttendeeCheckedIn -> Processing turnstile metrics`);
            await this.notifySponsorWebhook("CHECKIN", "Attendee", "Passed Gate Turnstile verification");
          } else if (log.includes("GrantDisbursed")) {
            console.log(`[Event Detected] GrantDisbursed -> Triggering real-time sponsor notification`);
            await this.notifySponsorWebhook("CLAIM", "Attendee", "Claimed 0.15 SOL Hacker Micro-Stipend");
          }
        }
      },
      "confirmed"
    );
  }
}

// ----------------------------------------------------------------------------
// CLI RUNNER COMMAND LINE DEMO
// ----------------------------------------------------------------------------
async function main() {
  const adminKey = Keypair.generate();
  const service = new BreakpointEnterpriseService({
    rpcUrl: process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"),
    programId: "BrkPntLndn1111111111111111111111111111111111",
    adminKeypair: adminKey,
    resendApiKey: process.env.RESEND_API_KEY || "",
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
    eventId: "BREAKPOINT-LDN-2025",
  });

  console.log("=== Breakpoint London Starter Pack CLI Daemon Running ===");
  service.startEventListener();

  // Test Resend integration trigger mock
  if (process.env.RESEND_API_KEY && process.env.TEST_EMAIL) {
    await service.sendDynamicTicketEmail(
      process.env.TEST_EMAIL,
      adminKey.publicKey.toBase58(),
      "Hacker Tier"
    );
  }
}

if (require.main === module) {
  main().catch(console.error);
}