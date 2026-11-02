import { Command } from 'commander';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as fs from 'fs';

const program = new Command();
program.name('london-cli').description('Administrative CLI for Solana Breakpoint Starter Pack');

function loadKeypair(path: string): Keypair {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

program
  .command('init-event')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON')
  .requiredOption('-n, --name <string>', 'Event name (e.g. Breakpoint London 2024)')
  .option('-p, --perk <lamports>', 'Perk amount in lamports', '50000000') // 0.05 SOL
  .option('-m, --max-claims <count>', 'Max number of claims', '1000')
  .option('-r, --rpc <url>', 'Solana RPC URL', 'https://api.devnet.solana.com')
  .option('--program-id <id>', 'Program ID', 'LonPack1111111111111111111111111111111111111')
  .action(async (options) => {
    const authority = loadKeypair(options.keypair);
    const connection = new Connection(options.rpc, 'confirmed');
    const programId = new PublicKey(options.programId);

    const eventId = crypto.createHash('sha256').update(options.name).digest();
    const [eventPda] = PublicKey.findProgramAddressSync([Buffer.from('event'), eventId], programId);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault'), eventId], programId);

    console.log(`Initializing Event PDA: ${eventPda.toBase58()}`);
    console.log(`Treasury Vault PDA: ${vaultPda.toBase58()}`);

    const ixDiscriminator = crypto.createHash('sha256').update('global:initialize_event').digest().subarray(0, 8);

    // Serialize payload: name string (4 byte len + bytes), perk_amount (u64), max_claims (u64)
    const nameBuffer = Buffer.from(options.name, 'utf8');
    const nameLenBuf = Buffer.alloc(4);
    nameLenBuf.writeUInt32LE(nameBuffer.length, 0);

    const perkBuf = Buffer.alloc(8);
    perkBuf.writeBigUInt64LE(BigInt(options.perk), 0);

    const maxClaimsBuf = Buffer.alloc(8);
    maxClaimsBuf.writeBigUInt64LE(BigInt(options.maxClaims), 0);

    const data = Buffer.concat([
      ixDiscriminator,
      eventId,
      nameLenBuf,
      nameBuffer,
      perkBuf,
      maxClaimsBuf,
    ]);

    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    // Also fund treasury vault with starting balance (1 SOL default)
    const fundIx = SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: vaultPda,
      lamports: 1_000_000_000,
    });

    const tx = new Transaction().add(ix).add(fundIx);
    const sig = await connection.sendTransaction(tx, [authority], { skipPreflight: false });
    await connection.confirmTransaction(sig, 'confirmed');

    console.log(`Event initialized and treasury funded successfully! Tx: ${sig}`);
  });

program.parse(process.argv);