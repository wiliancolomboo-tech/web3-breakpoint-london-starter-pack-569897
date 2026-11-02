import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LondonStarterPack } from "../target/types/london_starter_pack";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("london_starter_pack test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LondonStarterPack as Program<LondonStarterPack>;
  const authority = (provider.wallet as anchor.Wallet).payer;

  const eventName = "Breakpoint London 2024 Demo";
  const eventId = crypto.createHash("sha256").update(eventName).digest();
  const perkAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
  const maxClaims = new anchor.BN(2);

  let eventPda: PublicKey;
  let vaultPda: PublicKey;
  let vaultBump: number;

  const attendeeOne = Keypair.generate();
  const attendeeTwo = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  before(async () => {
    [eventPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("event"), eventId],
      program.programId
    );
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), eventId],
      program.programId
    );

    // Fund attendees with base rent for accounts
    const airdropTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: attendeeOne.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: unauthorizedUser.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(airdropTx);
  });

  it("1. Successfully initializes an event and funds the vault PDA", async () => {
    await program.methods
      .initializeEvent(Array.from(eventId), eventName, perkAmount, maxClaims)
      .accounts({
        eventRegistry: eventPda,
        treasuryVault: vaultPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fund vault directly
    const fundVaultTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: vaultPda,
        lamports: 1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundVaultTx);

    const eventAccount = await program.account.eventRegistry.fetch(eventPda);
    expect(eventAccount.name).to.equal(eventName);
    expect(eventAccount.totalClaims.toNumber()).to.equal(0);
    expect(eventAccount.isActive).to.be.true;

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.be.at.least(1 * LAMPORTS_PER_SOL);
  });

  it("2. Allows an attendee to claim perk with gas sponsored by relayer", async () => {
    const [claimPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), eventId, attendeeOne.publicKey.toBuffer()],
      program.programId
    );

    const balanceBefore = await provider.connection.getBalance(attendeeOne.publicKey);

    await program.methods
      .claimPerk(Array.from(eventId))
      .accounts({
        eventRegistry: eventPda,
        treasuryVault: vaultPda,
        claimRecord: claimPda,
        attendee: attendeeOne.publicKey,
        feePayer: authority.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const balanceAfter = await provider.connection.getBalance(attendeeOne.publicKey);
    expect(balanceAfter - balanceBefore).to.equal(perkAmount.toNumber());

    const claimRecord = await program.account.claimRecord.fetch(claimPda);
    expect(claimRecord.attendee.toBase58()).to.equal(attendeeOne.publicKey.toBase58());
  });

  it("3. Prevents double-claiming via strict PDA derivation collision", async () => {
    const [claimPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), eventId, attendeeOne.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .claimPerk(Array.from(eventId))
        .accounts({
          eventRegistry: eventPda,
          treasuryVault: vaultPda,
          claimRecord: claimPda,
          attendee: attendeeOne.publicKey,
          feePayer: authority.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Double claiming should have thrown an account already in use error.");
    } catch (err: any) {
      expect(err.toString()).to.include("already in use");
    }
  });

  it("4. Rejects unauthorized attempts to trigger emergency freeze", async () => {
    try {
      await program.methods
        .emergencyFreeze(Array.from(eventId), true)
        .accounts({
          eventRegistry: eventPda,
          authority: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .rpc();
      expect.fail("Unauthorized user should not be able to freeze event.");
    } catch (err: any) {
      expect(err.toString()).to.include("UnauthorizedAdmin");
    }
  });

  it("5. Allows authority to toggle emergency circuit breaker and blocks claims", async () => {
    // Freeze event
    await program.methods
      .emergencyFreeze(Array.from(eventId), true)
      .accounts({
        eventRegistry: eventPda,
        authority: authority.publicKey,
      })
      .rpc();

    const eventAccount = await program.account.eventRegistry.fetch(eventPda);
    expect(eventAccount.isActive).to.be.false;

    // Attempt claim by attendeeTwo while frozen
    const [claimPdaTwo] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), eventId, attendeeTwo.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .claimPerk(Array.from(eventId))
        .accounts({
          eventRegistry: eventPda,
          treasuryVault: vaultPda,
          claimRecord: claimPdaTwo,
          attendee: attendeeTwo.publicKey,
          feePayer: authority.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Claim should be blocked when event is frozen.");
    } catch (err: any) {
      expect(err.toString()).to.include("EventInactive");
    }

    // Unfreeze
    await program.methods
      .emergencyFreeze(Array.from(eventId), false)
      .accounts({
        eventRegistry: eventPda,
        authority: authority.publicKey,
      })
      .rpc();
  });
});