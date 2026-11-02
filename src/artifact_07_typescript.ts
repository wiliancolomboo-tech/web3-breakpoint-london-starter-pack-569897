import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BreakpointCore } from "../target/types/breakpoint_core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("breakpoint-core test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BreakpointCore as Program<BreakpointCore>;

  const adminAuthority = Keypair.generate();
  const paymasterPayer = Keypair.generate();
  const attendee = Keypair.generate();
  const sessionDelegate = Keypair.generate();

  const eventId = "LDN-2025";
  const eventName = "Breakpoint London Hacker House";

  let eventConfigPda: PublicKey;
  let passportPda: PublicKey;

  before(async () => {
    // Fund Admin & Paymaster accounts
    const airdrop1 = await provider.connection.requestAirdrop(
      adminAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const airdrop2 = await provider.connection.requestAirdrop(
      paymasterPayer.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop1, "confirmed");
    await provider.connection.confirmTransaction(airdrop2, "confirmed");

    [eventConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_config"), Buffer.from(eventId)],
      program.programId
    );

    [passportPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("passport"), eventConfigPda.toBuffer(), attendee.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Successfully initializes a Breakpoint event", async () => {
    await program.methods
      .initializeEvent(eventId, eventName, 1000)
      .accounts({
        eventConfig: eventConfigPda,
        authority: adminAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminAuthority])
      .rpc();

    const eventAccount = await program.account.eventConfig.fetch(eventConfigPda);
    expect(eventAccount.eventId).to.equal(eventId);
    expect(eventAccount.eventName).to.equal(eventName);
    expect(eventAccount.maxAttendees).to.equal(1000);
    expect(eventAccount.attendeeCount).to.equal(0);
    expect(eventAccount.isActive).to.be.true;
  });

  it("2. Registers attendee via Paymaster with Session Delegate", async () => {
    const validExpiry = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // +1 hour

    await program.methods
      .registerAttendee("Alice Builder", sessionDelegate.publicKey, validExpiry)
      .accounts({
        eventConfig: eventConfigPda,
        passport: passportPda,
        owner: attendee.publicKey,
        payer: paymasterPayer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([paymasterPayer])
      .rpc();

    const passport = await program.account.attendeePassport.fetch(passportPda);
    expect(passport.owner.toBase58()).to.equal(attendee.publicKey.toBase58());
    expect(passport.sessionDelegate.toBase58()).to.equal(sessionDelegate.publicKey.toBase58());
    expect(passport.attendeeName).to.equal("Alice Builder");
    expect(passport.xpPoints).to.equal(0);
    expect(passport.badgeClaimed).to.be.false;

    const eventAccount = await program.account.eventConfig.fetch(eventConfigPda);
    expect(eventAccount.attendeeCount).to.equal(1);
  });

  it("3. Executes booth check-in authorized purely by Session Delegate", async () => {
    // Booth 0: Solana Foundation Welcome
    await program.methods
      .recordCheckIn(0)
      .accounts({
        passport: passportPda,
        authorityOrDelegate: sessionDelegate.publicKey,
      })
      .signers([sessionDelegate])
      .rpc();

    let passport = await program.account.attendeePassport.fetch(passportPda);
    expect(passport.checkInBits).to.equal(1); // Bit 0 set
    expect(passport.xpPoints).to.equal(100);

    // Booth 1: DeFi Stage
    await program.methods
      .recordCheckIn(1)
      .accounts({
        passport: passportPda,
        authorityOrDelegate: sessionDelegate.publicKey,
      })
      .signers([sessionDelegate])
      .rpc();

    passport = await program.account.attendeePassport.fetch(passportPda);
    expect(passport.checkInBits).to.equal(3); // Bits 0 and 1 set (1 | 2 = 3)
    expect(passport.xpPoints).to.equal(200);
  });

  it("4. Prevents duplicate check-in to the same booth", async () => {
    try {
      await program.methods
        .recordCheckIn(0)
        .accounts({
          passport: passportPda,
          authorityOrDelegate: sessionDelegate.publicKey,
        })
        .signers([sessionDelegate])
        .rpc();
      expect.fail("Should have thrown AlreadyCheckedIn");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("AlreadyCheckedIn");
    }
  });

  it("5. Rejects non-delegate / non-owner signature", async () => {
    const maliciousAttacker = Keypair.generate();
    try {
      await program.methods
        .recordCheckIn(2)
        .accounts({
          passport: passportPda,
          authorityOrDelegate: maliciousAttacker.publicKey,
        })
        .signers([maliciousAttacker])
        .rpc();
      expect.fail("Should have thrown UnauthorizedSigner");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedSigner");
    }
  });

  it("6. Rejects badge claim if checkpoint requirements are not met", async () => {
    try {
      // Alice has visited 2 booths, but requirement is 3
      await program.methods
        .claimCompletionBadge(3)
        .accounts({
          passport: passportPda,
          owner: attendee.publicKey,
        })
        .signers([attendee])
        .rpc();
      expect.fail("Should have thrown InsufficientCheckins");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InsufficientCheckins");
    }
  });

  it("7. Successfully claims badge once threshold is reached", async () => {
    // Visit Booth 2: Hacker House Workshop
    await program.methods
      .recordCheckIn(2)
      .accounts({
        passport: passportPda,
        authorityOrDelegate: sessionDelegate.publicKey,
      })
      .signers([sessionDelegate])
      .rpc();

    // Now has visited 3 booths. Claim badge.
    await program.methods
      .claimCompletionBadge(3)
      .accounts({
        passport: passportPda,
        owner: attendee.publicKey,
      })
      .signers([attendee])
      .rpc();

    const passport = await program.account.attendeePassport.fetch(passportPda);
    expect(passport.badgeClaimed).to.be.true;
    expect(passport.xpPoints).to.equal(300 + 500); // 3 check-ins (300) + Badge (500) = 800 XP
  });
});