import fastify, { FastifyInstance } from 'fastify';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Resend } from 'resend';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import * as crypto from 'crypto';

dotenv.config();

const ENV_SCHEMA = z.object({
  PORT: z.string().default('8080'),
  SOLANA_RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
  RELAYER_PRIVATE_KEY: z.string().min(1),
  PROGRAM_ID: z.string().default('LonPack1111111111111111111111111111111111111'),
  EVENT_AUTHORITY_PUBKEY: z.string().min(1),
  RESEND_API_KEY: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
});

const config = ENV_SCHEMA.parse(process.env);
const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');

// Decode Relayer Keypair
const secretKey = Uint8Array.from(JSON.parse(config.RELAYER_PRIVATE_KEY));
const relayerKeypair = Keypair.fromSecretKey(secretKey);
const programId = new PublicKey(config.PROGRAM_ID);
const authorityPubkey = new PublicKey(config.EVENT_AUTHORITY_PUBKEY);

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

const app: FastifyInstance = fastify({ logger: true });

// Input validation schema
const ClaimPerkSchema = z.object({
  attendeePubkey: z.string().refine((val) => {
    try { new PublicKey(val); return true; } catch { return false; }
  }, 'Invalid Solana Public Key'),
  eventName: z.string().default('Solana Breakpoint London 2024'),
  attendeeEmail: z.string().email(),
});

function getEventId(name: string): Buffer {
  return crypto.createHash('sha256').update(name).digest();
}

app.get('/health', async () => {
  const balance = await connection.getBalance(relayerKeypair.publicKey);
  return {
    status: 'HEALTHY',
    relayerPubkey: relayerKeypair.publicKey.toBase58(),
    relayerSolBalance: balance / 1e9,
    solanaSlot: await connection.getSlot(),
  };
});

app.post('/api/claim', async (request, reply) => {
  const parseResult = ClaimPerkSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({ error: parseResult.error.errors });
  }

  const { attendeePubkey, eventName, attendeeEmail } = parseResult.data;
  const attendee = new PublicKey(attendeePubkey);
  const eventId = getEventId(eventName);

  // Derive PDAs
  const [eventPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('event'), eventId],
    programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), eventId],
    programId
  );

  const [claimPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('claim'), eventId, attendee.toBuffer()],
    programId
  );

  try {
    // Check if claim record already exists
    const claimAccountInfo = await connection.getAccountInfo(claimPda);
    if (claimAccountInfo !== null) {
      return reply.status(409).send({ error: 'Perk already claimed by this attendee.' });
    }

    // Anchor Instruction Discriminator for "claim_perk"
    const ixDiscriminator = crypto
      .createHash('sha256')
      .update('global:claim_perk')
      .digest()
      .subarray(0, 8);

    const instructionData = Buffer.concat([ixDiscriminator, eventId]);

    const claimIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: claimPda, isSigner: false, isWritable: true },
        { pubkey: attendee, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: authorityPubkey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: relayerKeypair.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
    }).add(claimIx);

    tx.sign(relayerKeypair);

    const txSignature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction({
      signature: txSignature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, 'confirmed');

    app.log.info({ txSignature, attendee: attendeePubkey }, 'Perk claimed successfully');

    // 1. Dispatch Resend Email Receipt
    if (resend) {
      await resend.emails.send({
        from: 'Breakpoint London <tickets@updates.solana-london.org>',
        to: attendeeEmail,
        subject: 'Confirmed: Breakpoint London Starter Pack Claimed!',
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #0b0e14; color: #ffffff; padding: 24px; border-radius: 8px;">
            <h1 style="color: #14F195;">Welcome to Breakpoint London</h1>
            <p>Your attendee starter pack and gas stipend have been delivered directly to your wallet.</p>
            <p><strong>Wallet Address:</strong> <code>${attendeePubkey}</code></p>
            <p><strong>Transaction Signature:</strong> <a href="https://solscan.io/tx/${txSignature}?cluster=devnet" style="color: #9945FF;">${txSignature.substring(0, 16)}...</a></p>
            <hr style="border: 0.5px solid #232a3b;" />
            <p style="font-size: 12px; color: #8892b0;">Powered by the Breakpoint London Starter Engine on Solana.</p>
          </div>
        `,
      }).catch(err => app.log.error(err, 'Failed to dispatch email via Resend'));
    }

    // 2. Dispatch Discord Webhook Notification
    if (config.DISCORD_WEBHOOK_URL) {
      await axios.post(config.DISCORD_WEBHOOK_URL, {
        embeds: [{
          title: "🎉 New Breakpoint London Check-in",
          color: 0x14F195,
          fields: [
            { name: "Attendee", value: `\`${attendeePubkey}\``, inline: true },
            { name: "Email", value: attendeeEmail, inline: true },
            { name: "Solscan", value: `[View Transaction](https://solscan.io/tx/${txSignature}?cluster=devnet)` }
          ],
          timestamp: new Date().toISOString()
        }]
      }).catch(err => app.log.error(err, 'Failed to deliver Discord notification'));
    }

    return reply.status(200).send({
      success: true,
      signature: txSignature,
      claimPda: claimPda.toBase58(),
    });

  } catch (error: any) {
    app.log.error(error);
    return reply.status(500).send({
      error: 'Transaction failed',
      details: error.message || error.toString(),
    });
  }
});

const start = async () => {
  try {
    const port = parseInt(config.PORT, 10);
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Enterprise Starter Relayer running on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();