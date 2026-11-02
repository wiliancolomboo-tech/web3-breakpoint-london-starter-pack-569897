import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BreakpointPassport } from "../target/types/breakpoint_passport";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert, expect } from "chai";

describe("Breakpoint London Starter Pack Protocol Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BreakpointPassport as Program<BreakpointPassport>;

  const admin = Keypair.generate();
  const sponsor = Keypair.generate();
  const attendee = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  const conferenceId = "london-2025";
  const capacity = 500;

  let conferencePDA: PublicKey;
  let vaultPDA: PublicKey;
  let passportPDA: PublicKey;

  before(async () => {
    // Airdrop funds to all actors
    for (const actor of [admin, sponsor, attendee, unauthorizedUser]) {
      const sig = await provider.connection.requestAirdrop(actor.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    [conferencePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("conference"), Buffer.from(conferenceId)],
      program.programId
    );

    [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), conferencePDA.toBuffer()],
      program.programId
    );

    [passportPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("passport"), conferencePDA.toBuffer(), attendee.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Initializes Breakpoint London Master Conference Registry", async () => {
    await program.methods
      .initializeConference(conferenceId, capacity)
      .accounts({
        conference: conferencePDA,
        authority: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const confAccount = await program.account.conferenceRegistry.fetch(conferencePDA);
    assert.equal(confAccount.conferenceId, conferenceId);
    assert.equal(confAccount.ticketCapacity, capacity);
    assert.equal(confAccount.totalRegistered, 0);
    assert.equal(confAccount.authority.toBase58(), admin.publicKey.toBase58());
  });

  it("2. Registers an Attendee with Hacker Tier Passport", async () => {
    const attendeeName = "Alice_Solana_Dev";

    await program.methods
      .registerAttendee(attendeeName, { generalHacker: {} })
      .accounts({
        conference: conferencePDA,
        passport: passportPDA,
        attendee: attendee.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([attendee])
      .rpc();

    const passportAccount = await program.account.attendeePassport.fetch(passportPDA);
    assert.equal(passportAccount.attendeeName, attendeeName);
    assert.equal(passportAccount.owner.toBase58(), attendee.publicKey.toBase58());
    assert.equal(passportAccount.checkInCount, 0);
    assert.equal(passportAccount.sessionBitmask.toNumber(), 0);

    const confAccount = await program.account.conferenceRegistry.fetch(conferencePDA);
    assert.equal(confAccount.totalRegistered, 1);
  });

  it("3. Successfully Checks In to Breakpoint Session Track #0 and #1", async () => {
    // Check in to Session 0 (Opening Keynote)
    await program.methods
      .sessionCheckIn(0)
      .accounts({
        conference: conferencePDA,
        passport: passportPDA,
        attendee: attendee.publicKey,
      })
      .signers([attendee])
      .rpc();

    // Check in to Session 1 (High Performance DeFi)
    await program.methods
      .sessionCheckIn(1)
      .accounts({
        conference: conferencePDA,
        passport: passportPDA,
        attendee: attendee.publicKey,
      })
      .signers([attendee])
      .rpc();

    const passportAccount = await program.account.attendeePassport.fetch(passportPDA);
    assert.equal(passportAccount.checkInCount, 2);
    // Bitmask: 1 << 0 | 1 << 1 = 1 | 2 = 3
    assert.equal(passportAccount.sessionBitmask.toNumber(), 3);
  });

  it("4. Prevents duplicate check-in to an already attended session", async () => {
    try {
      await program.methods
        .sessionCheckIn(0) // Already checked in
        .accounts({
          conference: conferencePDA,
          passport: passportPDA,
          attendee: attendee.publicKey,
        })
        .signers([attendee])
        .rpc();
      assert.fail("Should have thrown SessionAlreadyCheckedIn error");
    } catch (err: any) {
      expect(err.toString()).to.include("SessionAlreadyCheckedIn");
    }
  });

  it("5. Allows Sponsor to deposit funds into the Micro-Grant Vault PDA", async () => {
    const depositAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);

    await program.methods
      .depositSponsorGrant(depositAmount)
      .accounts({
        conference: conferencePDA,
        grantVault: vaultPDA,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const confAccount = await program.account.conferenceRegistry.fetch(conferencePDA);
    assert.equal(confAccount.vaultBalance.toNumber(), depositAmount.toNumber());

    const vaultBalance = await provider.connection.getBalance(vaultPDA);
    assert.isAtLeast(vaultBalance, depositAmount.toNumber());
  });

  it("6. Admin disburses micro-grant to verified attendee (check-ins >= 2)", async () => {
    const grantAmount = new anchor.BN(100_000_000); // 0.1 SOL
    const attendeeBalBefore = await provider.connection.getBalance(attendee.publicKey);

    await program.methods
      .claimMicroGrant(grantAmount)
      .accounts({
        conference: conferencePDA,
        grantVault: vaultPDA,
        passport: passportPDA,
        attendee: attendee.publicKey,
        authority: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    const attendeeBalAfter = await provider.connection.getBalance(attendee.publicKey);
    assert.equal(attendeeBalAfter - attendeeBalBefore, grantAmount.toNumber());

    const passportAccount = await program.account.attendeePassport.fetch(passportPDA);
    assert.equal(passportAccount.grantsClaimed.toNumber(), grantAmount.toNumber());
  });

  it("7. Blocks unauthorized actors from claiming grants", async () => {
    const grantAmount = new anchor.BN(50_000_000);

    try {
      await program.methods
        .claimMicroGrant(grantAmount)
        .accounts({
          conference: conferencePDA,
          grantVault: vaultPDA,
          passport: passportPDA,
          attendee: attendee.publicKey,
          authority: unauthorizedUser.publicKey, // Not conference admin
        })
        .signers([unauthorizedUser])
        .rpc();
      assert.fail("Should fail due to UnauthorizedAuthority");
    } catch (err: any) {
      expect(err.toString()).to.include("UnauthorizedAuthority");
    }
  });
});