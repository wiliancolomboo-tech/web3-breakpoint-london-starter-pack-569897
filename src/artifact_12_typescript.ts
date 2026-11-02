import { Command } from 'commander';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();
const RPC_URL = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'BrkP1ondon111111111111111111111111111111111'
);

function loadKeypair(path: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

program
  .name('breakpoint-cli')
  .description('Solana Breakpoint London Operations CLI')
  .version('1.0.0');

program
  .command('inspect-passport')
  .description('Inspect an attendee passport PDA status')
  .requiredOption('-c, --conference <string>', 'Conference identifier (e.g. london-2025)')
  .requiredOption('-a, --attendee <pubkey>', 'Attendee Wallet Public Key')
  .action(async (options) => {
    const connection = new Connection(RPC_URL, 'confirmed');
    const [confPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('conference'), Buffer.from(options.conference)],
      PROGRAM_ID
    );
    const [passportPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('passport'), confPDA.toBuffer(), new PublicKey(options.attendee).toBuffer()],
      PROGRAM_ID
    );

    console.log(`🔍 Querying Passport for Attendee: ${options.attendee}`);
    console.log(`📍 PDA Address: ${passportPDA.toBase58()}`);

    const acc = await connection.getAccountInfo(passportPDA);
    if (!acc) {
      console.log('❌ Passport PDA does not exist or is not initialized yet.');
      return;
    }
    console.log(`✅ Passport Account Found! Byte Length: ${acc.data.length}`);
    console.log(`Lamports: ${acc.lamports / LAMPORTS_PER_SOL} SOL`);
  });

program.parse(process.argv);