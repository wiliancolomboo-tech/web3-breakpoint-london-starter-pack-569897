import { Command } from "commander";
import { Keypair, PublicKey } from "@solana/web3.js";
import { sendEmailTicket, broadcastTelemetry } from "./service";

const program = new Command();

program
  .name("breakpoint-cli")
  .description("Solana Breakpoint London Enterprise Terminal Automation CLI")
  .version("1.0.0");

program
  .command("generate-keypair")
  .description("Generate an ephemeral attendee identity")
  .action(() => {
    const kp = Keypair.generate();
    console.log(`Public Key:  ${kp.publicKey.toBase58()}`);
    console.log(`Private Key: [${kp.secretKey.toString()}]`);
  });

program
  .command("issue-ticket")
  .description("Issue a pass, trigger Resend email, and post webhook notification")
  .requiredOption("-e, --event <id>", "Event ID identifier")
  .requiredOption("-a, --attendee <pubkey>", "Attendee Solana Public Key")
  .requiredOption("-m, --email <email>", "Attendee email address")
  .option("-t, --tier <tier>", "Pass Tier (General, Hacker, VIP, Speaker)", "Hacker")
  .action(async (options) => {
    console.log(`Issuing pass for ${options.attendee} in event '${options.event}'...`);
    await sendEmailTicket(options.email, options.attendee, options.event, options.tier);
    await broadcastTelemetry(`Manual Terminal Pass Issuance: ${options.tier}`, [
      { name: "Event", value: options.event },
      { name: "Recipient", value: options.email },
      { name: "Attendee Pubkey", value: options.attendee },
    ]);
    console.log("Operation completed successfully.");
  });

program.parse(process.argv);