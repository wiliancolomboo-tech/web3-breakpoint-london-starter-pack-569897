import { Command } from "commander";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { ResendService } from "./services/resendService";
import { CONFIG } from "./config";
import * as fs from "fs";

const programId = new PublicKey(CONFIG.programId);
const program = new Command();

function loadKeypair(path: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

program
  .name("breakpoint-cli")
  .description("Turnkey Operator CLI for Solana Breakpoint London")
  .version("1.0.0");

program
  .command("send-ticket-email")
  .requiredOption("-e, --email <email>", "Attendee email address")
  .requiredOption("-n, --name <name>", "Attendee display name")
  .requiredOption("-p, --pass <pda>", "Pass PDA address")
  .requiredOption("-t, --tier <tier>", "Pass Tier (General/Hacker/VIP/Speaker)")
  .action(async (opts) => {
    console.log(`[Action] Triggering transactional pass delivery for ${opts.email}...`);
    await ResendService.sendTicketConfirmation({
      attendeeEmail: opts.email,
      attendeeName: opts.name,
      passPda: opts.pass,
      tierName: opts.tier,
    });
  });

program
  .command("derive-pda")
  .requiredOption("-e, --event <name>", "Event unique name (e.g. 'Breakpoint2024')")
  .requiredOption("-w, --wallet <pubkey>", "Attendee Wallet Public Key")
  .action((opts) => {
    const [eventConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_config"), Buffer.from(opts.event)],
      programId
    );
    const [passPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("attendee_pass"), eventConfigPda.toBuffer(), new PublicKey(opts.wallet).toBuffer()],
      programId
    );

    console.log("=== Derived Addresses ===");
    console.log(`Event Config PDA: ${eventConfigPda.toBase58()}`);
    console.log(`Attendee Pass PDA: ${passPda.toBase58()}`);
  });

program.parse(process.argv);