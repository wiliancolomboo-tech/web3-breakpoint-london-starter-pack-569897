import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BreakpointCore } from "../target/types/breakpoint_core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("Breakpoint London Protocol Core QA Matrix", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BreakpointCore as Program<BreakpointCore>;

  const authority = (provider.wallet as any).payer as Keypair;
  const hacker = Keypair.generate();
  const sponsor = Keypair.generate();
  const builder = Keypair.generate();
  const arbiter = Keypair.generate();

  // Consistent 16-byte IDs
  const eventId = Array.from(Buffer.from("LONDON_BP_2024_01", "utf-8").subarray(0, 16));
  const grantId = Array.from(Buffer.from("GRANT_HACK_WINNER", "utf-8").subarray(0, 16));

  before(async () => {
    // Airdrop SOL to test actors
    const airdropSignatures = await Promise.all([
      provider.connection.requestAirdrop(hacker.publicKey, 2 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(sponsor.publicKey, 10 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(arbiter.publicKey, 2 * LAMPORTS_PER_SOL),
    ]);

    await Promise.all(
      airdropSignatures.map((sig) => provider.connection.confirmTransaction(sig, "confirmed"))
    );
  });

  it("1. Initializes Breakpoint Event Configuration correctly", async () => {
    const [eventConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_config"), Buffer.from(eventId)],
      program.programId
    );

    await program.methods
      .initializeEvent(eventId, 500)
      .accounts({
        authority: authority.publicKey,
        event_config: eventConfigPda,
        system_program: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const configAccount = await program.account.eventConfig.fetch(eventConfigPda);
    expect(configAccount.maxCapacity).to.equal(500);
    expect(configAccount.totalRegistered).to.equal(0);
    expect(configAccount.isActive).to.be.true;
    expect(configAccount.authority.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  it("2. Mints an Attendee Pass co-signed by Event Authority", async () => {
    const [eventConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_config"), Buffer.from(eventId)],
      program.programId
    );
    const [attendeePassPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("attendee_pass"), Buffer.from(eventId), hacker.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .mintPass(eventId, 0) // Tier 0 = Hacker
      .accounts({
        attendee: hacker.publicKey,
        event_config: eventConfigPda,
        authority: authority.publicKey,
        attendee_pass: attendeePassPda,
        system_program: SystemProgram.programId,
      })
      .signers([hacker, authority])
      .rpc();

    const pass = await program.account.attendeePass.fetch(attendeePassPda);
    expect(pass.attendee.toBase58()).to.equal(hacker.publicKey.toBase58());
    expect(pass.passTier).to.equal(0);

    const configAccount = await program.account.eventConfig.fetch(eventConfigPda);
    expect(configAccount.totalRegistered).to.equal(1);
  });

  it("3. Initializes a Milestone-Gated Micro-Grant Escrow", async () => {
    const [grantEscrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_escrow"), Buffer.from(grantId)],
      program.programId
    );
    const [grantVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_vault"), Buffer.from(grantId)],
      program.programId
    );

    const fundingAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);
    const currentClock = Math.floor(Date.now() / 1000);
    const deadline = new anchor.BN(currentClock + 86400); // 24 hours future

    await program.methods
      .initializeGrant(grantId, fundingAmount, deadline)
      .accounts({
        sponsor: sponsor.publicKey,
        recipient: builder.publicKey,
        arbiter: arbiter.publicKey,
        grant_escrow: grantEscrowPda,
        grant_vault: grantVaultPda,
        system_program: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const escrow = await program.account.grantEscrow.fetch(grantEscrowPda);
    expect(escrow.totalAmount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);
    expect(escrow.status).to.equal(0); // Active

    const vaultBalance = await provider.connection.getBalance(grantVaultPda);
    expect(vaultBalance).to.equal(3 * LAMPORTS_PER_SOL);
  });

  it("4. Rejects Unauthorized Milestone Approval Attempts", async () => {
    const [grantEscrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_escrow"), Buffer.from(grantId)],
      program.programId
    );
    const [grantVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_vault"), Buffer.from(grantId)],
      program.programId
    );

    try {
      // Hacker attempts to approve instead of Arbiter
      await program.methods
        .approveMilestone()
        .accounts({
          arbiter: hacker.publicKey,
          grant_escrow: grantEscrowPda,
          recipient: builder.publicKey,
          grant_vault: grantVaultPda,
          system_program: SystemProgram.programId,
        })
        .signers([hacker])
        .rpc();

      expect.fail("Expected transaction to fail due to unauthorized signer.");
    } catch (err: any) {
      expect(err.toString()).to.include("UnauthorizedSigner");
    }
  });

  it("5. Arbiter Approves Milestone & Releases Funds to Builder", async () => {
    const [grantEscrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_escrow"), Buffer.from(grantId)],
      program.programId
    );
    const [grantVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_vault"), Buffer.from(grantId)],
      program.programId
    );

    const initialBuilderBalance = await provider.connection.getBalance(builder.publicKey);

    await program.methods
      .approveMilestone()
      .accounts({
        arbiter: arbiter.publicKey,
        grant_escrow: grantEscrowPda,
        recipient: builder.publicKey,
        grant_vault: grantVaultPda,
        system_program: SystemProgram.programId,
      })
      .signers([arbiter])
      .rpc();

    const escrow = await program.account.grantEscrow.fetch(grantEscrowPda);
    expect(escrow.status).to.equal(1); // Completed
    expect(escrow.releasedAmount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);

    const finalBuilderBalance = await provider.connection.getBalance(builder.publicKey);
    expect(finalBuilderBalance - initialBuilderBalance).to.equal(3 * LAMPORTS_PER_SOL);

    const vaultBalance = await provider.connection.getBalance(grantVaultPda);
    expect(vaultBalance).to.equal(0);
  });

  it("6. Rejects Premature Refund Claim Before Deadline Expiry", async () => {
    const earlyGrantId = Array.from(Buffer.from("EARLY_REFUND_TST", "utf-8").subarray(0, 16));
    const [grantEscrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_escrow"), Buffer.from(earlyGrantId)],
      program.programId
    );
    const [grantVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_vault"), Buffer.from(earlyGrantId)],
      program.programId
    );

    const futureDeadline = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);

    // Initialize grant
    await program.methods
      .initializeGrant(earlyGrantId, new anchor.BN(1 * LAMPORTS_PER_SOL), futureDeadline)
      .accounts({
        sponsor: sponsor.publicKey,
        recipient: builder.publicKey,
        arbiter: arbiter.publicKey,
        grant_escrow: grantEscrowPda,
        grant_vault: grantVaultPda,
        system_program: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    // Attempt refund before deadline
    try {
      await program.methods
        .claimRefund()
        .accounts({
          sponsor: sponsor.publicKey,
          grant_escrow: grantEscrowPda,
          grant_vault: grantVaultPda,
          system_program: SystemProgram.programId,
        })
        .signers([sponsor])
        .rpc();

      expect.fail("Expected premature refund to fail.");
    } catch (err: any) {
      expect(err.toString()).to.include("RefundDeadlineNotMet");
    }
  });
});