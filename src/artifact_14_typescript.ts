import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  programId: process.env.PROGRAM_ID || "BrkPntLondon111111111111111111111111111111111",
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL || "tickets@breakpointlondon.io",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
  environment: process.env.NODE_ENV || "development",
};